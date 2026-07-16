import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  FileType2,
  Image as ImageIcon,
  Folder,
  FolderOpen,
  Search,
  Settings,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  ExternalFileChangeEvent,
  FileRecord,
  ImageAssetStrategy,
  PdfExportDocument,
  TreeEntry,
  CustomThemePackage,
  CustomThemeRecord,
} from '../shared/contracts';
import { defaultSettings } from '../shared/contracts';
import { defaultHtmlExportOptions, type HtmlExportOptions } from '../shared/html-export';
import { CanonicalDocument } from './documents/canonical-document';
import { documentModePolicy } from './documents/large-document-policy';
import { normalizeMarkdownFragment, resolveMarkdownLink } from './documents/markdown-links';
import { SourceEditor, type EditorViewSnapshot } from './editor/SourceEditor';
import {
  StructuredEditor,
  type StructuredEditorCommandId,
  type StructuredEditorHandle,
} from './editor/StructuredEditor';
import { TableInsertDialog } from './editor/TableInsertDialog';
import { TextInputDialog, validateLinkDestination } from './editor/TextInputDialog';
import { ImageDialog, type ImageDialogAction, type ImageDialogResult } from './images/ImageDialog';
import {
  findImageSyntax,
  insertImageSyntax,
  replaceImageSyntax,
  serializeImage,
  type ImageOptions,
  type ParsedImage,
} from './images/image-utils';
import { headingAnchors, markdownForExport } from './markdown/transform';
import {
  PandocDialog,
  type PandocConversionRequest as PandocUiConversionRequest,
  type PandocConversionState,
  type PandocImportRequest as PandocUiImportRequest,
  type PandocStatus,
} from './pandoc/PandocDialog';
import { DocumentSearchPanel, type SearchHighlightData } from './search/DocumentSearchPanel';
import {
  createSearchHistory,
  parseSearchHistory,
  serializeSearchHistory,
  type SearchHistoryState,
} from './search/search-history';
import { WorkspaceSearchPanel } from './search/WorkspaceSearchPanel';
import { HtmlExportDialog } from './export/HtmlExportDialog';
import { PdfExportDialog } from './export/PdfExportDialog';
import {
  createDefaultAppearanceSettings,
  importAppearanceSettings,
  migrateLegacyAdaptiveDefault,
  type AppearanceSettings,
} from './appearance/appearance-settings';
import { AppearancePanel } from './appearance/AppearancePanel';
import {
  appearanceClassNames,
  appearanceApplicationCssVariables,
  appearanceCustomThemeCss,
  appearanceCssVariables,
  appearanceDocumentCssVariables,
  themeDisplayName,
} from './appearance/themes';
import { applyDocumentFullscreen, withFullscreenSetting } from './appearance/fullscreen';
import { findWritingNavigationTarget, type WritingNavigationCommand } from './appearance/writing-navigation';
import {
  BASELINE_COMMAND_IDS,
  CommandPalette,
  CommandRegistry,
  LocalStorageShortcutPersistence,
  ShortcutDispatcher,
  ShortcutManager,
  ShortcutSettingsPanel,
  createBaselineCommandDefinitions,
  type BaselineCommandHandlers,
  type BaselineCommandId,
} from './commands';
import {
  ConflictDialog,
  RecoveryCenterDialog,
  RecoveryController,
  type ConflictResolution,
  type EditorDiskConflict,
  type RecoverableDocument,
  type RestorePlanItem,
} from './recovery';
import './styles.css';
import './editor-modes.css';
import './integration.css';

type Doc = Omit<FileRecord, 'content' | 'lineEnding'> & {
  id: string;
  model: CanonicalDocument;
  mode: 'source' | 'structured';
  spellLanguage?: string;
};

interface ImageDialogState {
  open: boolean;
  target?: ParsedImage;
}

interface AppCommandContext {
  hasDocument: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  structured: boolean;
  tableActive: boolean;
}

interface SourceLinkDialogState {
  readonly documentId: string;
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly initialValue: string;
  readonly canRemove: boolean;
}

interface TabContextMenuState {
  readonly documentId: string;
  readonly x: number;
  readonly y: number;
}

interface PendingDocumentAnchor {
  readonly path: string;
  readonly fragment: string;
}

type CommandActionMap = Record<BaselineCommandId, () => unknown>;

const imageStrategyMap: Record<ImageDialogResult['destination'], ImageAssetStrategy> = {
  'keep-original': 'keep-original',
  'document-directory': 'document-sibling',
  'assets-directory': 'assets',
  'document-assets-directory': 'document-assets',
  'workspace-assets-directory': 'workspace-assets',
  'date-directory': 'date-based',
};

const missingPandocStatus: PandocStatus = {
  availability: 'checking',
  detection: 'none',
  message: 'Checking common locations and PATH…',
};

const NEW_DOCUMENT_TEXT = '# Untitled\n\nStart writing in **Markdown**.';
const SUPPORTED_MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

function isSupportedMarkdownPath(filePath: string): boolean {
  const name = filePath.split(/[\\/]/u).pop() || filePath;
  const dot = name.lastIndexOf('.');
  return dot >= 0 && SUPPORTED_MARKDOWN_EXTENSIONS.has(name.slice(dot).toLocaleLowerCase());
}

const toPandocStatus = (status: Awaited<ReturnType<typeof window.markora.detectPandoc>>): PandocStatus => ({
  availability: status.available ? 'available' : status.status === 'invalid-manual' ? 'invalid' : 'missing',
  executablePath: status.executablePath,
  version: status.version,
  detection: status.source === 'common' ? 'common-directory' : (status.source ?? 'none'),
  message: status.message,
});

const createUntitled = (): Doc => ({
  id: crypto.randomUUID(),
  path: '',
  name: 'Untitled.md',
  modifiedAt: Date.now(),
  model: CanonicalDocument.createNew(NEW_DOCUMENT_TEXT),
  mode: 'structured',
});

const documentFromRecord = (record: FileRecord): Doc => {
  const policy = documentModePolicy(record.content);
  return {
    id: crypto.randomUUID(),
    path: record.path,
    name: record.name,
    modifiedAt: record.modifiedAt,
    fingerprint: record.fingerprint,
    model: CanonicalDocument.fromDisk(record.content, record.lineEnding === 'CRLF' ? 'crlf' : 'lf'),
    mode: policy.initialMode,
  };
};

const recoverableDocument = (
  document: Doc,
  active: boolean,
  content = document.model.serializedText,
): RecoverableDocument => ({
  id: document.id,
  path: document.path || undefined,
  name: document.name,
  content,
  lineEnding: document.model.lineEnding === 'crlf' ? 'CRLF' : 'LF',
  mode: document.mode,
  active,
  dirty: document.model.dirty,
});

const calculateStatistics = (text: string) => ({
  words: (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length,
  chars: text.length,
  lines: text ? text.split('\n').length : 0,
  headings: headingAnchors(text).length,
});

/** Public test seam for sanitized export/preview markup. */
export function markdownHtml(markdown: string): string {
  return markdownForExport(markdown);
}

async function renderMermaidForPdf(
  html: string,
  theme: AppearanceSettings['theme']['mermaidTheme'],
): Promise<string> {
  const template = document.createElement('template');
  template.innerHTML = html;
  const diagrams = Array.from(template.content.querySelectorAll<HTMLElement>('pre.mermaid'));
  if (!diagrams.length) return html;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
  for (const diagram of diagrams) {
    try {
      const { svg } = await mermaid.render(
        `markora-export-${crypto.randomUUID()}`,
        diagram.textContent || '',
      );
      const replacement = document.createElement('div');
      replacement.className = 'mermaid';
      replacement.innerHTML = String(
        DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['script', 'foreignObject'],
          FORBID_ATTR: ['onload', 'onclick', 'onerror'],
        }),
      );
      diagram.replaceWith(replacement);
    } catch (error) {
      const failure = document.createElement('pre');
      failure.className = 'mermaid-error';
      failure.textContent = `Mermaid export error: ${error instanceof Error ? error.message : 'Invalid diagram'}`;
      diagram.replaceWith(failure);
    }
  }
  return template.innerHTML;
}

function TreeNode({
  entry,
  level,
  openFile,
  tabbable,
  activePath,
}: {
  entry: TreeEntry;
  level: number;
  openFile(path: string): void;
  tabbable: boolean;
  activePath?: string;
}) {
  // Workspace folders start collapsed so opening a workspace does not flood
  // the sidebar with its entire hierarchy. Expansion is an explicit user action.
  const [expanded, setExpanded] = useState(false);
  const hasChildren = entry.type === 'folder' && Boolean(entry.children?.length);
  const extension = entry.name.split('.').pop()?.toLocaleLowerCase() ?? '';
  const iconKind =
    extension === 'md' || extension === 'markdown'
      ? 'markdown'
      : ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(extension)
        ? 'image'
        : ['json', 'yaml', 'yml'].includes(extension)
          ? 'data'
          : ['ts', 'tsx', 'js', 'jsx', 'css', 'html'].includes(extension)
            ? 'code'
            : 'file';
  const FileIcon =
    iconKind === 'markdown'
      ? FileText
      : iconKind === 'image'
        ? ImageIcon
        : iconKind === 'data'
          ? FileJson
          : iconKind === 'code'
            ? FileCode2
            : FileType2;
  const isActive = entry.type === 'file' && entry.path === activePath;
  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-expanded={entry.type === 'folder' && hasChildren ? expanded : undefined}
      style={{ '--tree-level': level } as React.CSSProperties}
      data-tree-entry="true"
      data-tree-type={entry.type}
    >
      {entry.type === 'folder' ? (
        <>
          {hasChildren ? (
            <button
              type="button"
              tabIndex={tabbable ? 0 : -1}
              data-tree-folder="true"
              data-tree-row="true"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} folder ${entry.name}`}
              onClick={() => setExpanded((value) => !value)}
            >
              <span className="tree-chevron" aria-hidden="true">
                {expanded ? (
                  <ChevronDown size={14} strokeWidth={1.8} />
                ) : (
                  <ChevronRight size={14} strokeWidth={1.8} />
                )}
              </span>
              <span className="tree-entry-icon tree-entry-icon-folder" aria-hidden="true">
                {expanded ? (
                  <FolderOpen size={16} strokeWidth={1.7} />
                ) : (
                  <Folder size={16} strokeWidth={1.7} />
                )}
              </span>
              <span className="tree-entry-name">{entry.name}</span>
            </button>
          ) : (
            <div
              className="tree-empty-folder"
              data-tree-row="true"
              aria-label={`Empty folder ${entry.name}`}
              style={{ '--tree-level': level } as React.CSSProperties}
            >
              <span className="tree-chevron tree-chevron-placeholder" aria-hidden="true" />
              <span className="tree-entry-icon tree-entry-icon-folder" aria-hidden="true">
                <Folder size={16} strokeWidth={1.7} />
              </span>
              <span className="tree-entry-name">{entry.name}</span>
            </div>
          )}
          {hasChildren ? (
            <ul role="group" hidden={!expanded}>
              {(entry.children || []).map((child) => (
                <TreeNode
                  key={child.path}
                  entry={child}
                  level={level + 1}
                  openFile={openFile}
                  tabbable={false}
                  activePath={activePath}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          tabIndex={tabbable ? 0 : -1}
          title={entry.path}
          data-tree-row="true"
          className={isActive ? 'active' : ''}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => openFile(entry.path)}
        >
          <span className="tree-chevron tree-chevron-placeholder" aria-hidden="true" />
          <span className={`tree-entry-icon tree-entry-icon-${iconKind}`} aria-hidden="true">
            <FileIcon size={16} strokeWidth={1.7} />
          </span>
          <span className="tree-entry-name">{entry.name}</span>
        </button>
      )}
    </li>
  );
}

function Tree({
  entries,
  open,
  activePath,
}: {
  entries: TreeEntry[];
  open(path: string): void;
  activePath?: string;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('li[role="treeitem"] > button'),
    ).filter((control) => !control.closest('[hidden]'));
    const current = controls.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowDown') next = Math.min(controls.length - 1, current + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = controls.length - 1;
    else if (event.key === 'ArrowRight' && controls[current].dataset.treeFolder) {
      if (controls[current].getAttribute('aria-expanded') === 'false') controls[current].click();
      else next = Math.min(controls.length - 1, current + 1);
    } else if (event.key === 'ArrowLeft' && controls[current].dataset.treeFolder) {
      if (controls[current].getAttribute('aria-expanded') === 'true') controls[current].click();
    } else return;
    event.preventDefault();
    controls[next]?.focus();
  };
  return (
    <ul className="tree" role="tree" aria-label="Workspace files" onKeyDown={handleKeyDown}>
      {entries.map((entry, index) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          level={1}
          openFile={open}
          tabbable={index === 0}
          activePath={activePath}
        />
      ))}
    </ul>
  );
}

function App() {
  const [docs, setDocs] = useState<Doc[]>(() => [createUntitled()]);
  const [activeId, setActiveId] = useState(() => docs[0].id);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [pendingDocumentAnchor, setPendingDocumentAnchor] = useState<PendingDocumentAnchor | null>(null);
  const [workspace, setWorkspace] = useState<{ path: string; tree: TreeEntry[] } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [sidebar, setSidebar] = useState<'files' | 'outline' | 'search' | 'settings'>('files');
  const [imageDialog, setImageDialog] = useState<ImageDialogState>({ open: false });
  const [imageOperationId, setImageOperationId] = useState<string | null>(null);
  const [pandocOpen, setPandocOpen] = useState(false);
  const [pandocStatus, setPandocStatus] = useState<PandocStatus>(missingPandocStatus);
  const [pandocConversion, setPandocConversion] = useState<PandocConversionState>({ state: 'idle' });
  const [pandocOperationId, setPandocOperationId] = useState<string | null>(null);
  const [htmlExportOpen, setHtmlExportOpen] = useState(false);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [pdfExportDocument, setPdfExportDocument] = useState<PdfExportDocument | null>(null);
  const [pdfPreparing, setPdfPreparing] = useState(false);
  const [spellcheckStatus, setSpellcheckStatus] = useState<Awaited<
    ReturnType<typeof window.markora.getSpellcheckStatus>
  > | null>(null);
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false);
  const [tableInsertOpen, setTableInsertOpen] = useState(false);
  const [dictionaryDialogOpen, setDictionaryDialogOpen] = useState(false);
  const [sourceLinkDialog, setSourceLinkDialog] = useState<SourceLinkDialogState | null>(null);
  const [documentReplaceMode, setDocumentReplaceMode] = useState(false);
  const [documentHighlights, setDocumentHighlights] = useState<SearchHighlightData>();
  const [documentSearchHistory, setDocumentSearchHistory] = useState<SearchHistoryState>(() => {
    try {
      return parseSearchHistory(localStorage.getItem('markora.documentSearchHistory'));
    } catch {
      return createSearchHistory();
    }
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingChord, setPendingChord] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [diskConflict, setDiskConflict] = useState<EditorDiskConflict | null>(null);
  const [restorePlan, setRestorePlan] = useState<RestorePlanItem[]>([]);
  const [recoveryCenterOpen, setRecoveryCenterOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => {
    const saved = localStorage.getItem('markora.appearance');
    if (!saved) return createDefaultAppearanceSettings();
    try {
      const imported = importAppearanceSettings(saved).settings;
      const migrated = migrateLegacyAdaptiveDefault(imported);
      if (migrated !== imported) {
        localStorage.setItem('markora.appearance', JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      return createDefaultAppearanceSettings();
    }
  });
  const [customThemes, setCustomThemes] = useState<CustomThemeRecord[]>([]);
  const initialFullscreenRef = useRef(appearance.writing.fullscreen);
  const [structuredTableActive, setStructuredTableActive] = useState(false);
  const structuredEditorRef = useRef<StructuredEditorHandle>(null);
  const setStructuredEditorHandle = useCallback((handle: StructuredEditorHandle | null) => {
    structuredEditorRef.current = handle;
  }, []);
  const active = docs.find((document) => document.id === activeId) || docs[0];
  const recoveryControllerRef = useRef<RecoveryController | null>(null);
  if (!recoveryControllerRef.current) {
    recoveryControllerRef.current = new RecoveryController(window.markora);
  }
  const recoveryController = recoveryControllerRef.current;
  const docsRef = useRef(docs);
  const activeIdRef = useRef(activeId);
  const workspaceRef = useRef(workspace);
  docsRef.current = docs;
  activeIdRef.current = activeId;
  workspaceRef.current = workspace;

  useEffect(() => {
    if (active) {
      document.title = `${active.model.dirty ? '• ' : ''}${active.name} - Markora`;
    } else {
      document.title = 'Markora';
    }
  }, [active?.name, active?.model.dirty]);

  useEffect(() => {
    if (
      !pendingDocumentAnchor ||
      active.path !== pendingDocumentAnchor.path ||
      active.mode !== 'structured'
    ) {
      return;
    }
    const anchors = headingAnchors(active.model.text);
    const anchorIndex = anchors.findIndex(
      (item) =>
        item.id === pendingDocumentAnchor.fragment ||
        normalizeMarkdownFragment(item.id) === pendingDocumentAnchor.fragment,
    );
    if (anchorIndex < 0) {
      setAnnouncement(`Opened ${active.name}; heading #${pendingDocumentAnchor.fragment} was not found.`);
      setPendingDocumentAnchor(null);
      return;
    }
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('.structured-prosemirror :is(h1,h2,h3,h4,h5,h6)'),
    );
    const heading = headings[anchorIndex];
    if (!heading) return;
    heading.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setAnnouncement(`Opened ${active.name} at heading ${pendingDocumentAnchor.fragment}.`);
    setPendingDocumentAnchor(null);
  }, [active, pendingDocumentAnchor]);

  const commandContextRef = useRef<AppCommandContext>({
    hasDocument: true,
    dirty: false,
    canUndo: false,
    canRedo: false,
    structured: true,
    tableActive: false,
  });
  commandContextRef.current = {
    hasDocument: Boolean(active),
    dirty: active.model.dirty,
    canUndo: active.model.canUndo,
    canRedo: active.model.canRedo,
    structured: active.mode === 'structured',
    tableActive: active.mode === 'structured' && structuredTableActive,
  };
  const commandActionsRef = useRef<Partial<CommandActionMap>>({});
  const registryRef = useRef<CommandRegistry<AppCommandContext> | null>(null);
  const shortcutManagerRef = useRef<ShortcutManager<AppCommandContext> | null>(null);
  if (!registryRef.current) {
    const registry = new CommandRegistry<AppCommandContext>(() => commandContextRef.current);
    const handlers = Object.fromEntries(
      BASELINE_COMMAND_IDS.map((id) => [id, () => commandActionsRef.current[id]?.()]),
    ) as unknown as BaselineCommandHandlers<AppCommandContext>;
    registry.registerMany(
      createBaselineCommandDefinitions(handlers, {
        'file.save': (context) => context.hasDocument,
        'file.saveAs': (context) => context.hasDocument,
        'file.close': (context) => context.hasDocument,
        'editor.undo': (context) => context.canUndo,
        'editor.redo': (context) => context.canRedo,
        'table.addRowBefore': (context) => context.tableActive,
        'table.addRowAfter': (context) => context.tableActive,
        'table.addColumnBefore': (context) => context.tableActive,
        'table.addColumnAfter': (context) => context.tableActive,
        'table.deleteRow': (context) => context.tableActive,
        'table.deleteColumn': (context) => context.tableActive,
        'table.copyMarkdown': (context) => context.tableActive,
        'table.copyTsv': (context) => context.tableActive,
        'table.delete': (context) => context.tableActive,
      }),
    );
    const manager = new ShortcutManager(registry, new LocalStorageShortcutPersistence(localStorage));
    try {
      manager.load();
    } catch (error) {
      console.warn('Shortcut settings could not be loaded.', error);
    }
    registryRef.current = registry;
    shortcutManagerRef.current = manager;
  }
  const commandRegistry = registryRef.current!;
  const shortcutManager = shortcutManagerRef.current!;
  const statistics = useMemo(
    () => calculateStatistics(active.model.text),
    [active.model.text, active.model.revision],
  );

  const updateDoc = (id: string, changes: Partial<Doc>) => {
    setDocs((items) =>
      items.map((document) => (document.id === id ? { ...document, ...changes } : document)),
    );
  };
  const updateActiveContent = (content: string) => {
    active.model.setText(content);
    setDocs((items) => items.map((document) => (document.id === active.id ? { ...document } : document)));
  };
  const updateViewState = (mode: 'source' | 'structured', state: EditorViewSnapshot) => {
    active.model.setViewSnapshot(mode, state);
    setDocs((items) => items.map((document) => (document.id === active.id ? { ...document } : document)));
  };
  const openRecord = (record: FileRecord) => {
    const existing = docs.find((document) => document.path === record.path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    recoveryController.rememberFile(record);
    const next = documentFromRecord(record);
    setDocs((items) => [...items, next]);
    setActiveId(next.id);
  };
  const open = async () => {
    const record = await window.markora.openFile();
    if (record) openRecord(record);
  };
  const save = async (forceSaveAs = false): Promise<FileRecord | null> => {
    const documentId = active.id;
    const model = active.model;
    const ticket = model.beginSave();
    try {
      const result = await recoveryController.save(
        recoverableDocument(active, active.id === activeId, ticket.diskText),
        forceSaveAs,
      );
      if (!result) {
        model.failSave(ticket);
        return null;
      }
      if (result.status === 'conflict') {
        model.failSave(ticket);
        const latest = docsRef.current.find((document) => document.id === documentId) ?? active;
        setDiskConflict({
          result,
          document: recoverableDocument(latest, latest.id === activeIdRef.current),
          detectedAt: Date.now(),
        });
        setActiveId(documentId);
        setAnnouncement(`Save stopped. ${latest.name} has a disk conflict.`);
        return null;
      }
      if (result.status === 'failed') {
        model.failSave(ticket);
        const recoveryNote = result.failure.recoverySnapshotId
          ? ' Your editor text was stored in recovery.'
          : '';
        window.alert(`Save failed: ${result.failure.message}${recoveryNote}`);
        setAnnouncement(`Save failed for ${active.name}.`);
        return null;
      }
      const saved = result.file;
      const completion = model.completeSave(ticket);
      setDocs((items) =>
        items.map((document) =>
          document.id === documentId
            ? {
                ...document,
                path: saved.path,
                name: saved.name,
                modifiedAt: saved.modifiedAt,
                fingerprint: saved.fingerprint,
              }
            : document,
        ),
      );
      if (completion.status === 'saved') await window.markora.clearRecovery(documentId);
      else {
        await window.markora.saveRecovery({
          id: documentId,
          path: saved.path,
          name: saved.name,
          content: model.serializedText,
          lineEnding: model.lineEnding === 'crlf' ? 'CRLF' : 'LF',
          reason: 'autosave',
        });
      }
      setAnnouncement(`${saved.name} saved.`);
      return saved;
    } catch (error) {
      model.failSave(ticket);
      window.alert(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  };
  const resolveDiskConflict = async (resolution: ConflictResolution) => {
    if (!diskConflict) return;
    const current = docsRef.current.find((document) => document.id === diskConflict.document.id);
    if (!current) {
      setDiskConflict(null);
      return;
    }
    const saveAction = resolution === 'save-copy' || resolution === 'overwrite';
    const ticket = saveAction ? current.model.beginSave() : null;
    const currentConflict: EditorDiskConflict = {
      ...diskConflict,
      document: recoverableDocument(
        current,
        current.id === activeIdRef.current,
        ticket?.diskText ?? current.model.serializedText,
      ),
    };
    try {
      const outcome = await recoveryController.resolveConflict(currentConflict, resolution);
      if (outcome.action === 'reload') {
        current.model.reloadFromDisk(
          outcome.file.content,
          outcome.file.lineEnding === 'CRLF' ? 'crlf' : 'lf',
        );
        setDocs((items) =>
          items.map((document) =>
            document.id === current.id
              ? {
                  ...document,
                  path: outcome.file.path,
                  name: outcome.file.name,
                  modifiedAt: outcome.file.modifiedAt,
                  fingerprint: outcome.file.fingerprint,
                }
              : document,
          ),
        );
        setDiskConflict(null);
        setAnnouncement(`${outcome.file.name} reloaded from disk.`);
        return;
      }
      if (outcome.action === 'keep') {
        current.model.markDiskVersionDiverged();
        setDocs((items) =>
          items.map((document) => (document.id === current.id ? { ...document } : document)),
        );
        setDiskConflict(null);
        setAnnouncement(`${current.name}: editor version kept in recovery.`);
        return;
      }
      if (outcome.action === 'cancelled') {
        if (ticket) current.model.failSave(ticket);
        return;
      }
      if (outcome.action === 'unresolved') {
        if (ticket) current.model.failSave(ticket);
        if (outcome.result.status === 'conflict') {
          setDiskConflict({
            document: currentConflict.document,
            result: outcome.result,
            detectedAt: currentConflict.detectedAt,
          });
        } else {
          window.alert(`Save failed: ${outcome.result.failure.message}`);
        }
        return;
      }
      if (!ticket) return;
      const completion = current.model.completeSave(ticket);
      const saved = outcome.result.file;
      setDocs((items) =>
        items.map((document) =>
          document.id === current.id
            ? {
                ...document,
                path: saved.path,
                name: saved.name,
                modifiedAt: saved.modifiedAt,
                fingerprint: saved.fingerprint,
              }
            : document,
        ),
      );
      if (completion.status === 'stale') {
        await window.markora.saveRecovery({
          id: current.id,
          path: saved.path,
          name: saved.name,
          content: current.model.serializedText,
          lineEnding: current.model.lineEnding === 'crlf' ? 'CRLF' : 'LF',
          reason: 'autosave',
        });
      }
      setDiskConflict(null);
      setAnnouncement(`${saved.name} saved after conflict resolution.`);
    } catch (error) {
      if (ticket) current.model.failSave(ticket);
      throw error;
    }
  };
  const closeMany = (ids: readonly string[]) => {
    const idSet = new Set(ids);
    const selected = docs.filter((item) => idSet.has(item.id));
    if (!selected.length) return false;
    const dirty = selected.filter((item) => item.model.dirty);
    if (dirty.length) {
      const names = dirty.map((item) => item.name).join(', ');
      const suffix = dirty.length === 1 ? 'has unsaved changes' : 'have unsaved changes';
      if (!window.confirm(`${names} ${suffix}. Close without saving?`)) return false;
    }
    for (const document of selected) {
      if (document.model.dirty) void window.markora.clearRecovery(document.id);
      if (document.path) {
        void window.markora.unwatchFile(document.path);
        recoveryController.forgetFile(document.path);
      }
      if (diskConflict?.document.id === document.id) setDiskConflict(null);
    }
    const remaining = docs.filter((item) => !idSet.has(item.id));
    if (!remaining.length) remaining.push(createUntitled());
    setDocs(remaining);
    if (idSet.has(activeId)) setActiveId(remaining[0].id);
    setTabContextMenu(null);
    return true;
  };
  const close = (id: string) => {
    closeMany([id]);
  };
  const restoreDocuments = async (selected: readonly RestorePlanItem[]) => {
    const restored: Doc[] = [];
    const restoredIds = new Set<string>();
    const failures: string[] = [];
    for (const item of selected) {
      try {
        const source = await recoveryController.restore(item);
        if ('snapshotId' in source) {
          const policy = documentModePolicy(source.content);
          restored.push({
            id: item.id,
            path: source.path || '',
            name: source.name || item.name,
            modifiedAt: source.updatedAt,
            model: CanonicalDocument.createNew(source.content, source.lineEnding === 'CRLF' ? 'crlf' : 'lf'),
            mode: item.mode === 'structured' && policy.structuredModeAllowed ? 'structured' : 'source',
          });
        } else {
          const restoredFile = documentFromRecord(source);
          const policy = documentModePolicy(source.content);
          restored.push({
            ...restoredFile,
            id: item.id,
            mode: item.mode === 'structured' && policy.structuredModeAllowed ? 'structured' : 'source',
          });
        }
        restoredIds.add(item.id);
      } catch (error) {
        failures.push(`${item.name}: ${error instanceof Error ? error.message : 'restore failed'}`);
      }
    }
    if (restored.length) {
      setDocs((items) => {
        const restoredIdSet = new Set(restored.map((document) => document.id));
        const withoutReplaced = items.filter((document) => !restoredIdSet.has(document.id));
        const withoutBootstrap =
          withoutReplaced.length === 1 &&
          !withoutReplaced[0].path &&
          withoutReplaced[0].name === 'Untitled.md' &&
          withoutReplaced[0].model.text === NEW_DOCUMENT_TEXT
            ? []
            : withoutReplaced;
        return [...withoutBootstrap, ...restored];
      });
      const requestedActive = selected.find((item) => item.active && restoredIds.has(item.id));
      setActiveId(requestedActive?.id ?? restored[0].id);
    }
    const remaining = restorePlan.filter((item) => !restoredIds.has(item.id));
    setRestorePlan(remaining);
    setRecoveryCenterOpen(remaining.length > 0);
    if (failures.length) {
      setAnnouncement(`${restored.length} document(s) restored; ${failures.length} failed.`);
      throw new Error(failures.join('\n'));
    }
    setAnnouncement(`${restored.length} document(s) restored.`);
  };
  const discardRecoveryItems = async (selected: readonly RestorePlanItem[]) => {
    await Promise.all(
      selected.filter((item) => item.snapshot).map((item) => window.markora.clearRecovery(item.id)),
    );
    const discardedIds = new Set(selected.map((item) => item.id));
    const remaining = restorePlan.filter((item) => !discardedIds.has(item.id));
    setRestorePlan(remaining);
    setRecoveryCenterOpen(remaining.length > 0);
    setAnnouncement(`${selected.length} recovery item(s) discarded.`);
  };
  const openWorkspace = async () => {
    const result = await window.markora.openWorkspace();
    if (result) {
      setWorkspace(result);
      setSidebar('files');
    }
  };
  const openWorkspaceFile = async (filePath: string) => {
    if (!isSupportedMarkdownPath(filePath)) {
      const name = filePath.split(/[\\/]/u).pop() || filePath;
      const message = `${name} is not a Markdown document that Markora can open here.`;
      setAnnouncement(message);
      window.alert(`Unsupported file format\n\n${message}`);
      return;
    }
    try {
      openRecord(await window.markora.openPath(filePath));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The file could not be opened.';
      setAnnouncement(message);
      window.alert(message);
    }
  };
  const openDocumentLink = async (href: string) => {
    const resolution = resolveMarkdownLink(href, active.path, workspace?.path);
    if (resolution.kind === 'external') {
      const opened = await window.markora.openExternal(resolution.url);
      if (!opened) setAnnouncement('The external link could not be opened.');
      return;
    }
    if (resolution.kind === 'anchor') {
      const anchor = headingAnchors(active.model.text).find(
        (item) =>
          item.id === resolution.fragment || normalizeMarkdownFragment(item.id) === resolution.fragment,
      );
      if (anchor) openHeadingAtLine(anchor.line);
      else setAnnouncement(`Heading anchor #${resolution.fragment} was not found.`);
      return;
    }
    if (resolution.kind === 'invalid') {
      setAnnouncement(resolution.reason);
      window.alert(resolution.reason);
      return;
    }
    const filePath = resolution.path;
    if (!isSupportedMarkdownPath(filePath)) {
      const name = filePath.split(/[\\/]/u).pop() || filePath;
      const message = `${name} is not a Markdown document that Markora can open here.`;
      setAnnouncement(message);
      window.alert(`Unsupported file format\n\n${message}`);
      return;
    }
    try {
      const record = await window.markora.openPath(filePath);
      openRecord(record);
      if (resolution.fragment) {
        setPendingDocumentAnchor({ path: record.path, fragment: resolution.fragment });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The linked document could not be opened.';
      setAnnouncement(message);
      window.alert(message);
    }
  };
  const openWorkspaceResult = async (filePath: string, line: number, column: number) => {
    const record = await window.markora.openPath(filePath);
    const lines = record.content.split(/\r?\n/);
    const offset =
      lines.slice(0, Math.max(0, line - 1)).reduce((total, value) => total + value.length + 1, 0) +
      Math.max(0, column - 1);
    const existing = docs.find((document) => document.path === record.path);
    if (existing) {
      const current = existing.model.getViewSnapshot('source');
      existing.model.setViewSnapshot('source', { ...current, anchor: offset, head: offset });
      updateDoc(existing.id, { mode: 'source' });
      setActiveId(existing.id);
      return;
    }
    const next = documentFromRecord(record);
    next.mode = 'source';
    next.model.setViewSnapshot('source', { anchor: offset, head: offset, scrollTop: 0, scrollLeft: 0 });
    setDocs((items) => [...items, next]);
    setActiveId(next.id);
  };
  const openHeadingAtLine = (line: number) => {
    const lines = active.model.text.split('\n');
    const offset = lines
      .slice(0, Math.max(0, line - 1))
      .reduce((total, value) => total + value.length + 1, 0);
    const current = active.model.getViewSnapshot('source');
    active.model.setViewSnapshot('source', { ...current, anchor: offset, head: offset });
    setDocs((items) =>
      items.map((document) => (document.id === active.id ? { ...document, mode: 'source' } : document)),
    );
    setAnnouncement(`Moved to heading on line ${line}.`);
  };
  const setAndPersistSettings = (next: AppSettings) => {
    setSettings(next);
    void window.markora.saveSettings(next);
  };
  const setAndPersistAppearance = (next: AppearanceSettings) => {
    setAppearance(next);
    try {
      localStorage.setItem('markora.appearance', JSON.stringify(next));
    } catch {
      // Appearance remains active for this session when storage is unavailable.
    }
  };
  const persistFullscreenState = (enabled: boolean) => {
    setAppearance((current) => {
      const next = withFullscreenSetting(current, enabled);
      if (next === current) return current;
      try {
        localStorage.setItem('markora.appearance', JSON.stringify(next));
      } catch {
        // Fullscreen state remains active for this session when storage is unavailable.
      }
      return next;
    });
  };
  const setAndPersistAppearanceFromPanel = (next: AppearanceSettings) =>
    setAndPersistAppearance(withFullscreenSetting(next, Boolean(document.fullscreenElement)));

  const importCustomTheme = async () => {
    const imported = await window.markora.importCustomTheme();
    if (imported)
      setCustomThemes((current) => [...current.filter((theme) => theme.id !== imported.id), imported]);
    return imported;
  };
  const duplicateCustomTheme = async (id: string) => {
    const duplicated = await window.markora.duplicateCustomTheme(id);
    setCustomThemes((current) => [...current, duplicated]);
    return duplicated;
  };
  const deleteCustomTheme = async (id: string) => {
    await window.markora.deleteCustomTheme(id);
    setCustomThemes((current) => current.filter((theme) => theme.id !== id));
  };
  const exportCustomTheme = (id: string) => window.markora.exportCustomTheme(id);
  const saveCustomTheme = async (theme: CustomThemePackage) => {
    const saved = await window.markora.saveCustomTheme(theme);
    setCustomThemes((current) => [...current.filter((item) => item.id !== saved.id), saved]);
    return saved;
  };

  const openImageDialog = (structuredImage?: ImageOptions) => {
    const cursor = active.model.getViewSnapshot('source').anchor;
    const images = findImageSyntax(active.model.text);
    const target = structuredImage
      ? images.find(
          (image) =>
            image.src === structuredImage.src &&
            (structuredImage.alt === undefined || image.alt === structuredImage.alt),
        )
      : active.mode === 'source'
        ? images.find((image) => cursor >= image.range.start && cursor <= image.range.end)
        : undefined;
    setImageDialog({ open: true, target });
  };

  const applyImage = async (result: ImageDialogResult) => {
    const documentId = active.id;
    const documentModel = active.model;
    const documentMode = active.mode;
    const imageTarget = imageDialog.target;
    const operationId = crypto.randomUUID();
    setImageOperationId(operationId);
    try {
      const backendStrategy = imageStrategyMap[result.destination];
      let imageSource = result.src;
      const isRemote = result.sourceKind === 'url';
      const keepingExisting = Boolean(
        imageTarget && result.src === imageTarget.src && backendStrategy === 'keep-original',
      );
      if (!(isRemote && backendStrategy === 'keep-original') && !keepingExisting) {
        const selectedPath = result.selectedFile?.path || result.src;
        const fallbackName = isRemote
          ? (() => {
              try {
                return new URL(result.src).pathname.split('/').pop() || 'remote-image';
              } catch {
                return 'remote-image';
              }
            })()
          : selectedPath.split(/[\\/]/).pop() || 'image';
        const asset = await window.markora.importImageAsset({
          operationId,
          source: isRemote ? { kind: 'remote', url: result.src } : { kind: 'local', path: selectedPath },
          strategy: backendStrategy,
          filename: fallbackName,
          context: {
            documentPath: active.path || undefined,
            workspaceRoot: workspace?.path,
          },
          conflictPolicy: 'rename',
          markdownPathPreference: 'auto',
        });
        imageSource = asset.markdownPath;
      }
      const image = {
        src: imageSource,
        alt: result.alt,
        title: result.title,
        width: result.width,
        height: result.height,
        preserveAspectRatio: result.preserveAspectRatio,
        alignment: result.alignment,
      };
      const source = documentModel.text;
      if (imageTarget) {
        documentModel.setText(replaceImageSyntax(source, imageTarget, image));
      } else if (documentMode === 'source') {
        const snapshot = documentModel.getViewSnapshot('source');
        const start = Math.min(snapshot.anchor, snapshot.head);
        const end = Math.max(snapshot.anchor, snapshot.head);
        const withoutSelection = `${source.slice(0, start)}${source.slice(end)}`;
        documentModel.setText(insertImageSyntax(withoutSelection, start, image));
      } else {
        const separator = source.trimEnd() ? '\n\n' : '';
        documentModel.setText(`${source.trimEnd()}${separator}${insertImageSyntax('', 0, image)}\n`);
      }
      setDocs((items) => items.map((document) => (document.id === documentId ? { ...document } : document)));
      setImageDialog({ open: false });
    } catch (error) {
      window.alert(`Image operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setImageOperationId(null);
    }
  };

  const importImageFiles = async (files: File[]): Promise<ImageOptions[]> => {
    let documentPath = active.path;
    if (!documentPath) {
      const saved = await save();
      if (!saved) throw new Error('Save the document before pasting or dropping image assets.');
      documentPath = saved.path;
    }
    const mimeByExtension: Record<string, string> = {
      avif: 'image/avif',
      bmp: 'image/bmp',
      gif: 'image/gif',
      ico: 'image/x-icon',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      webp: 'image/webp',
    };
    const imported: ImageOptions[] = [];
    for (const file of files) {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
      const mimeType = file.type || mimeByExtension[extension];
      if (!mimeType?.startsWith('image/')) continue;
      const operationId = crypto.randomUUID();
      setImageOperationId(operationId);
      const asset = await window.markora.importImageAsset({
        operationId,
        source: {
          kind: 'clipboard',
          data: new Uint8Array(await file.arrayBuffer()),
          mimeType,
        },
        strategy: 'assets',
        filename: file.name || `pasted-image-${Date.now()}.${extension}`,
        context: { documentPath, workspaceRoot: workspace?.path },
        conflictPolicy: 'rename',
        markdownPathPreference: 'auto',
      });
      imported.push({
        src: asset.markdownPath,
        alt: file.name.replace(/\.[^.]+$/, '') || 'Pasted image',
        preserveAspectRatio: true,
        alignment: 'default',
      });
    }
    setImageOperationId(null);
    return imported;
  };

  const runImageAction = async (action: ImageDialogAction) => {
    const target = imageDialog.target;
    if (!target) return;
    try {
      if (action === 'remove') {
        if (!window.confirm('Remove this image from the document? The asset file will be kept.')) return;
        active.model.replaceText(target.range.start, target.range.end, '');
        setDocs((items) => items.map((document) => (document.id === active.id ? { ...document } : document)));
        setImageDialog({ open: false });
        return;
      }
      if (action === 'copy-path') {
        await navigator.clipboard.writeText(target.src);
        return;
      }
      if (action === 'localize') {
        await applyImage({
          ...target,
          operation: 'edit',
          sourceKind: 'url',
          destination: 'assets-directory',
        });
        return;
      }
      if (/^https?:\/\//i.test(target.src)) {
        if (action === 'open') await window.markora.openExternal(target.src);
        else throw new Error('Save the remote image locally before revealing or copying its pixels.');
        return;
      }
      const localPath = await window.markora.resolveImageReference({
        reference: target.src,
        documentPath: active.path || undefined,
        workspaceRoot: workspace?.path,
      });
      if (action === 'reveal') await window.markora.revealPath(localPath);
      if (action === 'open') await window.markora.openPathExternal(localPath);
      if (action === 'copy-image') await window.markora.copyImageToClipboard(localPath);
    } catch (error) {
      window.alert(`Image action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const insertSourceImageFiles = async (files: File[], range: { from: number; to: number }) => {
    const documentId = active.id;
    const revision = active.model.revision;
    try {
      const imported = await importImageFiles(files);
      if (!imported.length) return;
      const markup = imported.map((image) => serializeImage(image)).join('\n\n');
      const document = docsRef.current.find((candidate) => candidate.id === documentId);
      if (!document) return;
      const source = document.model.text;
      if (document.model.revision === revision) {
        document.model.replaceText(range.from, range.to, markup);
      } else {
        document.model.setText(`${source.trimEnd()}\n\n${markup}\n`);
      }
      setDocs((items) =>
        items.map((candidate) => (candidate.id === documentId ? { ...candidate } : candidate)),
      );
    } catch (error) {
      setImageOperationId(null);
      window.alert(`Image paste/drop failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const openPandoc = async () => {
    setPandocOpen(true);
    setPandocStatus(missingPandocStatus);
    try {
      setPandocStatus(toPandocStatus(await window.markora.detectPandoc()));
    } catch (error) {
      setPandocStatus({
        availability: 'error',
        detection: 'none',
        message: error instanceof Error ? error.message : 'Pandoc detection failed.',
      });
    }
  };

  const previewPandocImport = async (request: PandocUiImportRequest) => {
    const operationId = crypto.randomUUID();
    try {
      const result = await window.markora.previewPandocImport({
        operationId,
        executablePath: request.executablePath,
        format: request.format,
        inputPath: request.inputPath,
      });
      return {
        ok: true as const,
        markdown: result.markdown || '',
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: { message: error instanceof Error ? error.message : 'Pandoc import preview failed.' },
      };
    }
  };

  const convertWithPandoc = async (request: PandocUiConversionRequest) => {
    const operationId = crypto.randomUUID();
    setPandocOperationId(operationId);
    setPandocConversion({
      state: 'running',
      phase: 'preparing',
      message: 'Preparing Pandoc conversion…',
      percent: 5,
      cancellable: true,
    });
    try {
      if (request.operation === 'export') {
        const result = await window.markora.exportWithPandoc({
          operationId,
          executablePath: request.executablePath,
          format: request.format,
          outputPath: request.outputPath,
          markdown: active.model.serializedText,
          metadata: { title: active.name.replace(/\.md(?:own)?$/i, '') },
        });
        setPandocConversion({
          state: 'succeeded',
          message: `Exported with Pandoc ${result.version}.`,
          outputPath: result.outputPath,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } else {
        const result = await window.markora.previewPandocImport({
          operationId,
          executablePath: request.executablePath,
          format: request.format,
          inputPath: request.inputPath,
        });
        const imported: Doc = {
          id: crypto.randomUUID(),
          path: '',
          name: `${
            request.inputPath
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.[^.]+$/, '') || 'Imported'
          }.md`,
          modifiedAt: Date.now(),
          model: CanonicalDocument.createNew(result.markdown || ''),
          mode: 'structured',
        };
        setDocs((items) => [...items, imported]);
        setActiveId(imported.id);
        setPandocConversion({
          state: 'succeeded',
          message: `Imported with Pandoc ${result.version}. Review and save the new Markdown document.`,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pandoc conversion failed.';
      setPandocConversion(
        message.includes('CANCELLED')
          ? { state: 'cancelled', message: 'Pandoc conversion was cancelled.' }
          : { state: 'failed', error: { message } },
      );
    } finally {
      setPandocOperationId(null);
    }
  };

  const createDocument = () => {
    const document = createUntitled();
    setDocs((items) => [...items, document]);
    setActiveId(document.id);
  };

  const mutateActiveModel = (mutation: (model: CanonicalDocument) => void) => {
    mutation(active.model);
    setDocs((items) => items.map((document) => (document.id === active.id ? { ...document } : document)));
  };

  const runStructuredCommand = (id: StructuredEditorCommandId) =>
    structuredEditorRef.current?.executeCommandLocal(id) ?? false;

  const toggleSourceMarker = (openingMarker: string, closingMarker = openingMarker) => {
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const start = Math.min(snapshot.anchor, snapshot.head);
      const end = Math.max(snapshot.anchor, snapshot.head);
      const selected = model.text.slice(start, end);
      const hasMarkers =
        start >= openingMarker.length &&
        model.text.slice(start - openingMarker.length, start) === openingMarker &&
        model.text.slice(end, end + closingMarker.length) === closingMarker;
      if (hasMarkers) {
        model.replaceText(start - openingMarker.length, end + closingMarker.length, selected);
        model.setViewSnapshot('source', {
          ...snapshot,
          anchor: start - openingMarker.length,
          head: end - openingMarker.length,
        });
        return;
      }
      const replacement = `${openingMarker}${selected}${closingMarker}`;
      model.replaceText(start, end, replacement);
      const selectionStart = start + openingMarker.length;
      model.setViewSnapshot('source', {
        ...snapshot,
        anchor: selectionStart,
        head: selectionStart + selected.length,
      });
    });
  };

  const toggleSourceLinePrefix = (prefix: string, matcher: RegExp) => {
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const selectionStart = Math.min(snapshot.anchor, snapshot.head);
      const selectionEnd = Math.max(snapshot.anchor, snapshot.head);
      const start = model.text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
      const followingBreak = model.text.indexOf('\n', selectionEnd);
      const end = followingBreak < 0 ? model.text.length : followingBreak;
      const lines = model.text.slice(start, end).split('\n');
      const populated = lines.filter((line) => line.trim());
      const remove = populated.length > 0 && populated.every((line) => matcher.test(line));
      const replacement = lines
        .map((line) => {
          if (!line && !remove) return prefix;
          return remove ? line.replace(matcher, '') : `${prefix}${line}`;
        })
        .join('\n');
      model.replaceText(start, end, replacement);
      model.setViewSnapshot('source', { ...snapshot, anchor: start, head: start + replacement.length });
    });
  };

  const setSourceBlockStyle = (headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null) => {
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const selectionStart = Math.min(snapshot.anchor, snapshot.head);
      const selectionEnd = Math.max(snapshot.anchor, snapshot.head);
      const start = model.text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
      const followingBreak = model.text.indexOf('\n', selectionEnd);
      const end = followingBreak < 0 ? model.text.length : followingBreak;
      const replacement = model.text
        .slice(start, end)
        .split('\n')
        .map((line) => {
          const content = line.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/u, '').replace(/[ \t]+#+[ \t]*$/u, '');
          return headingLevel === null ? content : `${'#'.repeat(headingLevel)} ${content}`;
        })
        .join('\n');
      model.replaceText(start, end, replacement);
      model.setViewSnapshot('source', {
        ...snapshot,
        anchor: start,
        head: start + replacement.length,
      });
    });
  };

  const toggleSourceCodeBlock = () => {
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const start = Math.min(snapshot.anchor, snapshot.head);
      const end = Math.max(snapshot.anchor, snapshot.head);
      const selected = model.text.slice(start, end);
      const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/u.exec(selected);
      const replacement = fenced ? fenced[1] : `\`\`\`\n${selected}\n\`\`\``;
      model.replaceText(start, end, replacement);
      const contentStart = start + (fenced ? 0 : 4);
      model.setViewSnapshot('source', {
        ...snapshot,
        anchor: contentStart,
        head: contentStart + (fenced ? replacement.length : selected.length),
      });
    });
  };

  const insertSourceFence = (kind: 'math' | 'mermaid') => {
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const start = Math.min(snapshot.anchor, snapshot.head);
      const end = Math.max(snapshot.anchor, snapshot.head);
      const selected = model.text.slice(start, end);
      const body = selected || (kind === 'math' ? 'E = mc^2' : 'flowchart LR\n  Draft --> Publish');
      const replacement = `\`\`\`${kind}\n${body}\n\`\`\``;
      model.replaceText(start, end, replacement);
      const contentStart = start + kind.length + 4;
      model.setViewSnapshot('source', {
        ...snapshot,
        anchor: contentStart,
        head: contentStart + body.length,
      });
    });
  };

  const editSourceLink = () => {
    const snapshot = active.model.getViewSnapshot('source');
    const start = Math.min(snapshot.anchor, snapshot.head);
    const end = Math.max(snapshot.anchor, snapshot.head);
    const selected = active.model.text.slice(start, end);
    const existing = /^\[([^\]]*)\]\((\S+?)(?:\s+["'].*["'])?\)$/u.exec(selected);
    setSourceLinkDialog({
      documentId: active.id,
      start,
      end,
      label: existing?.[1] || selected || 'link text',
      initialValue: existing?.[2] || 'https://',
      canRemove: Boolean(existing),
    });
  };

  const insertTable = (rows: number, columns: number) => {
    if (active.mode === 'structured' && structuredEditorRef.current) {
      structuredEditorRef.current.insertTable(rows, columns);
      setTableInsertOpen(false);
      return;
    }
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const start = Math.min(snapshot.anchor, snapshot.head);
      const end = Math.max(snapshot.anchor, snapshot.head);
      const header = Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
      const format = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
      const table = [
        format(header),
        format(Array.from({ length: columns }, () => '---')),
        ...Array.from({ length: rows - 1 }, () => format(Array.from({ length: columns }, () => ''))),
      ].join('\n');
      model.replaceText(start, end, table);
      model.setViewSnapshot('source', {
        ...snapshot,
        anchor: start + 2,
        head: start + header[0].length + 2,
      });
    });
    setTableInsertOpen(false);
  };

  const createHtmlExportRequest = (options: HtmlExportOptions) => ({
    markdown: active.model.text,
    sourcePath: active.path || undefined,
    workspaceRoot: workspace?.path,
    options,
  });

  const openPdfExport = async () => {
    setPdfPreparing(true);
    try {
      const title = active.name.replace(/\.md(?:own)?$/i, '');
      const result = await window.markora.previewHtmlExport(
        createHtmlExportRequest({
          ...defaultHtmlExportOptions,
          standalone: false,
          styling: 'unstyled',
          embedCss: false,
          embedLocalImages: true,
          includeTableOfContents: false,
          metadata: { title },
        }),
      );
      const html = await renderMermaidForPdf(result.html, appearance.theme.mermaidTheme);
      setPdfExportDocument({
        html,
        headings: headingAnchors(active.model.text).map((heading) => ({
          depth: heading.depth as 1 | 2 | 3 | 4 | 5 | 6,
          text: heading.text,
          id: heading.id,
        })),
        sourcePath: active.path || undefined,
      });
      setPdfExportOpen(true);
    } catch (error) {
      window.alert(`PDF preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setPdfPreparing(false);
    }
  };

  const setFullscreen = async (enabled: boolean) => {
    try {
      const actual = await applyDocumentFullscreen(document, enabled);
      persistFullscreenState(actual);
    } catch (error) {
      persistFullscreenState(Boolean(document.fullscreenElement));
      throw error;
    }
  };

  const navigateWriting = (command: WritingNavigationCommand) => {
    if (active.mode === 'structured' && structuredEditorRef.current?.navigate(command)) return;
    mutateActiveModel((model) => {
      const snapshot = model.getViewSnapshot('source');
      const target = findWritingNavigationTarget(model.text, snapshot, command);
      if (!target) return;
      model.setViewSnapshot('source', {
        ...snapshot,
        anchor: target.selection.anchor,
        head: target.selection.head,
      });
    });
  };

  commandActionsRef.current = {
    'app.commandPalette': () => setCommandPaletteOpen(true),
    'file.new': createDocument,
    'file.open': open,
    'file.openFolder': openWorkspace,
    'file.save': () => save(),
    'file.saveAs': () => save(true),
    'file.close': () => close(active.id),
    'editor.undo': () =>
      mutateActiveModel((model) => {
        model.undo();
      }),
    'editor.redo': () =>
      mutateActiveModel((model) => {
        model.redo();
      }),
    'editor.toggleBold': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.toggleBold') : toggleSourceMarker('**'),
    'editor.toggleItalic': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.toggleItalic') : toggleSourceMarker('*'),
    'editor.toggleStrike': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.toggleStrike') : toggleSourceMarker('~~'),
    'editor.toggleUnderline': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.toggleUnderline')
        : toggleSourceMarker('<u>', '</u>'),
    'editor.toggleHighlight': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.toggleHighlight')
        : toggleSourceMarker('<mark>', '</mark>'),
    'editor.editLink': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.editLink') : editSourceLink(),
    'editor.setParagraph': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setParagraph') : setSourceBlockStyle(null),
    'editor.setHeading1': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setHeading1') : setSourceBlockStyle(1),
    'editor.setHeading2': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setHeading2') : setSourceBlockStyle(2),
    'editor.setHeading3': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setHeading3') : setSourceBlockStyle(3),
    'editor.setHeading4': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setHeading4') : setSourceBlockStyle(4),
    'editor.setHeading5': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setHeading5') : setSourceBlockStyle(5),
    'editor.setHeading6': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.setHeading6') : setSourceBlockStyle(6),
    'editor.toggleBulletList': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.toggleBulletList')
        : toggleSourceLinePrefix('- ', /^(?:[-+*])\s+(?!\[[ xX]\]\s)/u),
    'editor.toggleOrderedList': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.toggleOrderedList')
        : toggleSourceLinePrefix('1. ', /^\d+[.)]\s+/u),
    'editor.toggleTaskList': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.toggleTaskList')
        : toggleSourceLinePrefix('- [ ] ', /^(?:[-+*])\s+\[[ xX]\]\s+/u),
    'editor.toggleBlockquote': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.toggleBlockquote')
        : toggleSourceLinePrefix('> ', /^>\s?/u),
    'editor.toggleCodeBlock': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.toggleCodeBlock') : toggleSourceCodeBlock(),
    'editor.toggleSourceMode': () => {
      if (active.mode === 'source') {
        const policy = documentModePolicy(active.model.text);
        if (!policy.structuredModeAllowed) {
          setAnnouncement(policy.reason ?? 'This document is too large for Structured Mode.');
          window.alert(policy.reason);
          return;
        }
      }
      updateDoc(active.id, {
        mode: active.mode === 'source' ? 'structured' : 'source',
      });
    },
    'editor.insertTable': () => setTableInsertOpen(true),
    'editor.insertImage': openImageDialog,
    'editor.insertMath': () =>
      active.mode === 'structured' ? runStructuredCommand('editor.insertMath') : insertSourceFence('math'),
    'editor.insertMermaid': () =>
      active.mode === 'structured'
        ? runStructuredCommand('editor.insertMermaid')
        : insertSourceFence('mermaid'),
    'editor.find': () => {
      setDocumentReplaceMode(false);
      setDocumentSearchOpen(true);
    },
    'editor.replace': () => {
      setDocumentReplaceMode(true);
      setDocumentSearchOpen(true);
    },
    'table.addRowBefore': () => runStructuredCommand('table.addRowBefore'),
    'table.addRowAfter': () => runStructuredCommand('table.addRowAfter'),
    'table.addColumnBefore': () => runStructuredCommand('table.addColumnBefore'),
    'table.addColumnAfter': () => runStructuredCommand('table.addColumnAfter'),
    'table.deleteRow': () => runStructuredCommand('table.deleteRow'),
    'table.deleteColumn': () => runStructuredCommand('table.deleteColumn'),
    'table.copyMarkdown': () => runStructuredCommand('table.copyMarkdown'),
    'table.copyTsv': () => runStructuredCommand('table.copyTsv'),
    'table.delete': () => runStructuredCommand('table.delete'),
    'view.toggleFocusMode': () =>
      setAndPersistAppearance({
        ...appearance,
        writing: { ...appearance.writing, focusMode: !appearance.writing.focusMode },
      }),
    'view.toggleTypewriterMode': () =>
      setAndPersistAppearance({
        ...appearance,
        writing: { ...appearance.writing, typewriterMode: !appearance.writing.typewriterMode },
      }),
    'view.toggleZenMode': () =>
      setAndPersistAppearance({
        ...appearance,
        writing: { ...appearance.writing, zenMode: !appearance.writing.zenMode },
      }),
    'view.toggleOutline': () => setSidebar((value) => (value === 'outline' ? 'files' : 'outline')),
    'view.toggleFullscreen': () => setFullscreen(!document.fullscreenElement),
    'view.toggleScrollPastEnd': () =>
      setAndPersistAppearance({
        ...appearance,
        writing: { ...appearance.writing, scrollPastEnd: !appearance.writing.scrollPastEnd },
      }),
    'view.toggleWordWrap': () =>
      setAndPersistAppearance({
        ...appearance,
        writing: { ...appearance.writing, wordWrap: !appearance.writing.wordWrap },
      }),
    'navigation.top': () => navigateWriting('top'),
    'navigation.bottom': () => navigateWriting('bottom'),
    'navigation.selection': () => navigateWriting('selection'),
    'navigation.previousHeading': () => navigateWriting('previous-heading'),
    'navigation.nextHeading': () => navigateWriting('next-heading'),
    'navigation.previousParagraph': () => navigateWriting('previous-paragraph'),
    'navigation.nextParagraph': () => navigateWriting('next-paragraph'),
    'export.html': () => setHtmlExportOpen(true),
    'export.pdf': openPdfExport,
    'export.pandoc': openPandoc,
    'theme.gallery': () => setAppearanceOpen(true),
    'theme.white': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: {
          ...appearance.theme,
          colorMode: 'light',
          builtInTheme: 'white',
          uiThemeId: 'white',
          documentThemeId: 'white',
          documentTheme: 'white',
        },
      }),
    'theme.clean': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'markora', uiThemeId: 'markora' },
      }),
    'theme.paper': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'paper', uiThemeId: 'paper' },
      }),
    'theme.academic': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'academic', uiThemeId: 'academic' },
      }),
    'theme.sepia': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'sepia', uiThemeId: 'sepia' },
      }),
    'theme.graphite': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'graphite', uiThemeId: 'graphite' },
      }),
    'theme.midnight': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'midnight', uiThemeId: 'midnight' },
      }),
    'theme.highContrast': () =>
      setAndPersistAppearance({
        ...appearance,
        theme: { ...appearance.theme, builtInTheme: 'high-contrast', uiThemeId: 'high-contrast' },
      }),
  };

  const executeCommand = (id: BaselineCommandId) => {
    void commandRegistry.execute(id).catch((error) => {
      window.alert(error instanceof Error ? error.message : `Command ${id} failed.`);
    });
  };

  useEffect(() => window.markora.onCommand((id) => executeCommand(id)), [commandRegistry]);

  useEffect(() => {
    return window.markora.onPandocProgress((progress) => {
      if (progress.operationId !== pandocOperationId) return;
      const phase =
        progress.stage === 'completed'
          ? 'finishing'
          : progress.stage === 'converting'
            ? 'converting'
            : 'preparing';
      const percent =
        progress.stage === 'completed'
          ? 100
          : progress.stage === 'converting'
            ? 55
            : progress.stage === 'probing'
              ? 25
              : 10;
      setPandocConversion({
        state: 'running',
        phase,
        message: progress.message,
        percent,
        cancellable: progress.stage !== 'completed',
      });
    });
  }, [pandocOperationId]);

  useEffect(() => {
    let mounted = true;
    void window.markora.getSettings().then(setSettings);
    void window.markora.getSpellcheckStatus().then(setSpellcheckStatus);
    void window.markora
      .listCustomThemes()
      .then((themes) => {
        if (mounted) setCustomThemes(themes);
      })
      .catch((error) => {
        if (mounted)
          setAnnouncement(
            `Custom themes could not be loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
      });
    void recoveryController
      .loadRestorePlan()
      .then((plan) => {
        if (!mounted || !plan.length) return;
        setRestorePlan(plan);
        setRecoveryCenterOpen(true);
        setAnnouncement(`${plan.length} document(s) are available for session recovery.`);
      })
      .catch((error) => {
        if (mounted)
          setAnnouncement(
            `Recovery metadata could not be loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
      });
    const unsubscribe = window.markora.onExternalFileChange((event: ExternalFileChangeEvent) => {
      const document = docsRef.current.find((candidate) => candidate.path === event.path);
      if (!document) return;
      if (event.record) {
        const classification = document.model.classifyExternalChange(event.record.content);
        const safeToAccept =
          classification.kind === 'unchanged' ||
          classification.kind === 'matches-editor' ||
          (classification.kind === 'line-ending-only' && !document.model.dirty);
        if (safeToAccept && event.record.fingerprint) {
          const record = event.record;
          const prepareRenamedPath =
            event.kind === 'renamed'
              ? window.markora.unwatchFile(event.path).then(() => {
                  recoveryController.forgetFile(event.path);
                })
              : Promise.resolve();
          void prepareRenamedPath
            .then(() =>
              window.markora.acceptDiskVersion({ path: record.path, fingerprint: record.fingerprint! }),
            )
            .then(() => {
              document.model.reloadFromDisk(record.content, record.lineEnding === 'CRLF' ? 'crlf' : 'lf');
              recoveryController.rememberFile(record);
              setDocs((items) =>
                items.map((candidate) =>
                  candidate.id === document.id
                    ? {
                        ...candidate,
                        path: record.path,
                        name: record.name,
                        modifiedAt: record.modifiedAt,
                        fingerprint: record.fingerprint,
                      }
                    : candidate,
                ),
              );
              void window.markora.clearRecovery(document.id);
              setAnnouncement(`${document.name} now matches the version on disk.`);
            })
            .catch(() => undefined);
          return;
        }
      }
      setDiskConflict({
        ...recoveryController.externalConflict(
          event,
          recoverableDocument(document, document.id === activeIdRef.current),
        ),
        detectedAt: event.observedAt,
      });
      setActiveId(document.id);
      setAnnouncement(`${document.name} changed outside Markora. Choose a conflict action.`);
    });
    const unsubscribeOpenFiles = window.markora.onOpenFiles((paths) => {
      void (async () => {
        const failures: string[] = [];
        for (const filePath of paths) {
          try {
            openRecord(await window.markora.openPath(filePath));
          } catch (error) {
            const message = error instanceof Error ? error.message : 'open failed';
            failures.push(`${filePath}: ${message}`);
            console.error(`Could not open forwarded file ${filePath}.`, error);
          }
        }
        if (failures.length) {
          setAnnouncement(`${failures.length} forwarded file(s) could not be opened.`);
          window.alert(`Some files could not be opened:\n\n${failures.join('\n')}`);
        } else if (paths.length) {
          setAnnouncement(`${paths.length} forwarded file(s) opened.`);
        }
      })();
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeOpenFiles();
    };
  }, [recoveryController]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setPrefersDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const synchronize = () => {
      const enabled = Boolean(document.fullscreenElement);
      setAppearance((current) => {
        const next = withFullscreenSetting(current, enabled);
        if (next === current) return current;
        try {
          localStorage.setItem('markora.appearance', JSON.stringify(next));
        } catch {
          // Fullscreen state still remains synchronized for this session.
        }
        return next;
      });
    };
    document.addEventListener('fullscreenchange', synchronize);
    const restore = initialFullscreenRef.current;
    initialFullscreenRef.current = false;
    if (restore && !document.fullscreenElement) {
      void applyDocumentFullscreen(document, true).then(synchronize, synchronize);
    } else {
      synchronize();
    }
    return () => document.removeEventListener('fullscreenchange', synchronize);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('markora-mermaid-theme', { detail: appearance.theme.mermaidTheme }));
  }, [appearance.theme.mermaidTheme]);

  useEffect(() => {
    if (!spellcheckStatus) return;
    void window.markora.applyDocumentSpellcheck({
      enabled: spellcheckStatus.enabled,
      language: active.spellLanguage || spellcheckStatus.languages[0],
    });
  }, [active.id, active.spellLanguage, spellcheckStatus]);

  useEffect(() => {
    const persist = (reason: 'autosave' | 'shutdown') =>
      recoveryController.persistSession(
        docsRef.current.map((document) => recoverableDocument(document, document.id === activeIdRef.current)),
        workspaceRef.current?.path,
        reason,
      );
    const timer = window.setInterval(
      () => {
        void persist('autosave').catch((error) => {
          setAnnouncement(
            `Autosave recovery failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        });
      },
      Math.max(5, settings.autosaveSeconds) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [recoveryController, settings.autosaveSeconds]);

  useEffect(() => {
    const debounce = window.setTimeout(() => {
      void recoveryController
        .persistSession(
          docsRef.current.map((document) =>
            recoverableDocument(document, document.id === activeIdRef.current),
          ),
          workspaceRef.current?.path,
        )
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearTimeout(debounce);
  }, [activeId, docs, recoveryController, workspace]);

  useEffect(() => {
    const persistBeforeUnload = () => {
      void recoveryController.persistSession(
        docsRef.current.map((document) => recoverableDocument(document, document.id === activeIdRef.current)),
        workspaceRef.current?.path,
        'shutdown',
      );
    };
    window.addEventListener('beforeunload', persistBeforeUnload);
    return () => window.removeEventListener('beforeunload', persistBeforeUnload);
  }, [recoveryController]);

  useEffect(() => {
    const dispatcher = new ShortcutDispatcher(shortcutManager, {
      context: () => commandContextRef.current,
      onChordChange: (shortcut) => setPendingChord(shortcut ?? undefined),
      onError: (error) => {
        window.alert(error instanceof Error ? error.message : 'The shortcut command failed.');
      },
    });
    const shortcuts = (event: KeyboardEvent) => {
      dispatcher.handleKeyDown(event);
    };
    window.addEventListener('keydown', shortcuts, { capture: true });
    return () => {
      window.removeEventListener('keydown', shortcuts, { capture: true });
      dispatcher.dispose();
    };
  }, [shortcutManager]);

  useEffect(() => {
    if (!tabContextMenu) return;
    const dismiss = (event?: Event) => {
      if (event && event.target instanceof Element && event.target.closest('[data-tab-context-menu]')) return;
      setTabContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [tabContextMenu]);

  useEffect(() => {
    const timer = setTimeout(() => {
      document.body.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleDocumentTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Delete') {
      event.preventDefault();
      close(docs[index].id);
      return;
    }
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % docs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + docs.length) % docs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = docs.length - 1;
    else return;
    event.preventDefault();
    const next = docs[nextIndex];
    setActiveId(next.id);
    window.requestAnimationFrame(() => document.getElementById(`markora-tab-${next.id}`)?.focus());
  };

  const openTabContextMenu = (event: React.MouseEvent, documentId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setTabContextMenu({
      documentId,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 230)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 220)),
    });
  };

  const openTabContextMenuFromKeyboard = (event: React.KeyboardEvent, documentId: string) => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault();
    const target = event.currentTarget.getBoundingClientRect();
    setTabContextMenu({
      documentId,
      x: Math.min(target.left, Math.max(8, window.innerWidth - 230)),
      y: Math.min(target.bottom, Math.max(8, window.innerHeight - 220)),
    });
  };

  const sidebarTabs = ['files', 'outline', 'search', 'settings'] as const;
  const handleSidebarTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % sidebarTabs.length;
    else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + sidebarTabs.length) % sidebarTabs.length;
    } else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = sidebarTabs.length - 1;
    else return;
    event.preventDefault();
    const next = sidebarTabs[nextIndex];
    setSidebar(next);
    window.requestAnimationFrame(() => document.getElementById(`markora-sidebar-tab-${next}`)?.focus());
  };

  const resolvedTheme =
    appearance.theme.colorMode === 'system' ? (prefersDark ? 'dark' : 'light') : appearance.theme.colorMode;

  // Dialogs are portalled to document.body so the application root can be
  // inerted safely. Mirror only application UI tokens onto body; document
  // theme variables stay scoped to the editor and cannot recolor dialogs.
  useEffect(() => {
    const previous = new Map<string, string>();
    const variables = appearanceApplicationCssVariables(appearance, prefersDark, customThemes);
    for (const [name, value] of Object.entries(variables)) {
      previous.set(name, document.body.style.getPropertyValue(name));
      document.body.style.setProperty(name, value);
    }
    const previousMode = document.body.dataset.markoraDialogMode;
    document.body.dataset.markoraDialogMode = resolvedTheme;
    return () => {
      for (const name of Object.keys(variables)) {
        const value = previous.get(name);
        if (value) document.body.style.setProperty(name, value);
        else document.body.style.removeProperty(name);
      }
      if (previousMode) document.body.dataset.markoraDialogMode = previousMode;
      else delete document.body.dataset.markoraDialogMode;
    };
  }, [appearance, customThemes, prefersDark, resolvedTheme]);

  const activeInterfaceTheme = themeDisplayName(
    appearance.theme.uiThemeId ?? appearance.theme.builtInTheme,
    customThemes,
  );
  const activeDocumentTheme = themeDisplayName(
    appearance.theme.documentThemeId ?? appearance.theme.documentTheme,
    customThemes,
  );
  const appearanceClasses = appearanceClassNames(appearance).join(' ');
  return (
    <main
      className={`app ${resolvedTheme} ${appearanceClasses}`}
      style={appearanceCssVariables(appearance, prefersDark, customThemes) as React.CSSProperties}
      data-mermaid-theme={appearance.theme.mermaidTheme}
    >
      <a className="accessibility-skip-link" href="#markora-editor">
        Skip to editor
      </a>
      <div className="markora-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {/* Test Utility buttons for Playwright E2E compatibility */}
      {window.markora.isE2e ? (
        <div className="test-utility-buttons" data-markora-test-controls="true">
          <button aria-label="New document" onClick={createDocument}>
            New
          </button>
          <button
            aria-label="Open file"
            onClick={() => {
              void open();
            }}
          >
            Open
          </button>
          <button
            aria-label="Save file"
            onClick={() => {
              void save();
            }}
          >
            Save
          </button>
          <button
            aria-label="Toggle outline"
            onClick={() => setSidebar((value) => (value === 'outline' ? 'files' : 'outline'))}
          >
            Toggle outline
          </button>
          <button onClick={() => setTableInsertOpen(true)}>Table</button>
          <button aria-label="Edit link dialog" onClick={() => runStructuredCommand('editor.editLink')}>
            Link
          </button>
          <button
            onClick={() =>
              active.mode === 'structured'
                ? runStructuredCommand('editor.insertMath')
                : insertSourceFence('math')
            }
          >
            Math
          </button>
          <button
            onClick={() =>
              active.mode === 'structured'
                ? runStructuredCommand('editor.insertMermaid')
                : insertSourceFence('mermaid')
            }
          >
            Diagram
          </button>
          <button onClick={() => runStructuredCommand('table.addRowBefore')}>Row above</button>
          <button onClick={() => runStructuredCommand('table.addRowAfter')}>Row below</button>
          <button onClick={() => runStructuredCommand('table.addColumnBefore')}>Column before</button>
          <button onClick={() => runStructuredCommand('table.addColumnAfter')}>Column after</button>
          <button onClick={() => runStructuredCommand('table.deleteRow')}>Delete row</button>
          <button onClick={() => runStructuredCommand('table.deleteColumn')}>Delete column</button>
          <button onClick={() => runStructuredCommand('table.copyMarkdown')}>Copy Markdown</button>
          <button onClick={() => runStructuredCommand('table.copyTsv')}>Copy TSV</button>
          <button onClick={() => runStructuredCommand('table.delete')}>Delete table</button>
          <button title="Insert or edit image" onClick={() => openImageDialog()}>
            Insert or edit image
          </button>
          <button title="Export rendered HTML" onClick={() => setHtmlExportOpen(true)}>
            Export HTML
          </button>
          <button title="Export PDF" onClick={() => void openPdfExport()} disabled={pdfPreparing}>
            Export PDF
          </button>
          <span>{active.mode === 'source' ? 'Markdown source' : 'Structured document'}</span>
        </div>
      ) : null}
      {appearance.theme.customCss ? <style>{appearance.theme.customCss}</style> : null}
      {appearanceCustomThemeCss(appearance, customThemes) ? (
        <style data-markora-custom-theme>{appearanceCustomThemeCss(appearance, customThemes)}</style>
      ) : null}
      {docs.length > 1 || window.markora.isE2e ? (
        <header className="topbar" data-markora-region="tabBar">
          <div className="brand">
            <BookOpen size={16} /> Markora
          </div>
          <div className="tabs" role="tablist" aria-label="Open documents">
            {docs.map((document, index) => (
              <div className="tab-container" role="presentation" key={document.id}>
                <button
                  id={`markora-tab-${document.id}`}
                  role="tab"
                  aria-controls="markora-editor"
                  aria-selected={document.id === activeId}
                  aria-label={`${document.name}${document.model.dirty ? ', unsaved changes' : ''}`}
                  aria-keyshortcuts="Delete ArrowLeft ArrowRight Home End"
                  tabIndex={document.id === activeId ? 0 : -1}
                  className={`tab ${document.id === activeId ? 'active' : ''}`}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('[data-tab-close]')) close(document.id);
                    else setActiveId(document.id);
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      close(document.id);
                    }
                  }}
                  onContextMenu={(event) => openTabContextMenu(event, document.id)}
                  onKeyUp={(event) => openTabContextMenuFromKeyboard(event, document.id)}
                  onKeyDown={(event) => handleDocumentTabKeyDown(event, index)}
                >
                  <span className="tab-title">{document.name}</span>
                  {document.model.dirty && <span className="tab-dirty-indicator" title="Unsaved changes" />}
                  <span className="tab-close" data-tab-close aria-hidden="true" title="Close document">
                    <X size={12} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </header>
      ) : null}

      {tabContextMenu
        ? (() => {
            const targetIndex = docs.findIndex((document) => document.id === tabContextMenu.documentId);
            if (targetIndex < 0) return null;
            const closeTarget = () => close(tabContextMenu.documentId);
            const closeOthers = () =>
              closeMany(docs.filter((_, index) => index !== targetIndex).map((item) => item.id));
            const closeToRight = () => closeMany(docs.slice(targetIndex + 1).map((item) => item.id));
            const closeAll = () => closeMany(docs.map((item) => item.id));
            return (
              <div
                className="tab-context-menu"
                data-tab-context-menu="true"
                role="menu"
                aria-label={`Actions for ${docs[targetIndex].name}`}
                style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button type="button" role="menuitem" onClick={closeTarget}>
                  Close
                </button>
                <button type="button" role="menuitem" onClick={closeOthers} disabled={docs.length < 2}>
                  Close Others
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={closeToRight}
                  disabled={targetIndex === docs.length - 1}
                >
                  Close All to the Right
                </button>
                <span className="tab-context-divider" role="separator" />
                <button type="button" role="menuitem" onClick={closeAll} disabled={docs.length < 2}>
                  Close All
                </button>
              </div>
            );
          })()
        : null}

      <div className="body">
        <aside
          className="sidebar"
          aria-label="Workspace and document panels"
          data-markora-region={sidebar === 'outline' ? 'outlineSidebar' : 'workspaceSidebar'}
        >
          <div className="side-tabs" role="tablist" aria-label="Sidebar panels">
            <button
              id="markora-sidebar-tab-files"
              role="tab"
              aria-controls="markora-sidebar-panel-files"
              aria-selected={sidebar === 'files'}
              tabIndex={sidebar === 'files' ? 0 : -1}
              className={sidebar === 'files' ? 'active' : ''}
              onClick={() => setSidebar('files')}
              onKeyDown={(event) => handleSidebarTabKeyDown(event, 0)}
            >
              Files
            </button>
            <button
              id="markora-sidebar-tab-outline"
              role="tab"
              aria-controls="markora-sidebar-panel-outline"
              aria-selected={sidebar === 'outline'}
              tabIndex={sidebar === 'outline' ? 0 : -1}
              className={sidebar === 'outline' ? 'active' : ''}
              onClick={() => setSidebar('outline')}
              onKeyDown={(event) => handleSidebarTabKeyDown(event, 1)}
            >
              Outline
            </button>
            <button
              id="markora-sidebar-tab-search"
              role="tab"
              aria-controls="markora-sidebar-panel-search"
              aria-selected={sidebar === 'search'}
              tabIndex={sidebar === 'search' ? 0 : -1}
              aria-label="Workspace search"
              className={sidebar === 'search' ? 'active' : ''}
              onClick={() => setSidebar('search')}
              onKeyDown={(event) => handleSidebarTabKeyDown(event, 2)}
            >
              <Search size={14} />
            </button>
            <button
              id="markora-sidebar-tab-settings"
              role="tab"
              aria-controls="markora-sidebar-panel-settings"
              aria-selected={sidebar === 'settings'}
              tabIndex={sidebar === 'settings' ? 0 : -1}
              aria-label="Settings"
              className={sidebar === 'settings' ? 'active' : ''}
              onClick={() => setSidebar('settings')}
              onKeyDown={(event) => handleSidebarTabKeyDown(event, 3)}
            >
              <Settings size={14} />
            </button>
          </div>
          {sidebar === 'files' && (
            <section
              id="markora-sidebar-panel-files"
              role="tabpanel"
              aria-labelledby="markora-sidebar-tab-files"
            >
              {!workspace ? (
                <div className="sidebar-empty-state">
                  <div className="empty-icon">
                    <FolderOpen size={32} />
                  </div>
                  <h4>No workspace open</h4>
                  <p>Open a folder to view your project files and search across documents.</p>
                  <button className="empty-cta-btn" onClick={() => executeCommand('file.openFolder')}>
                    Open workspace
                  </button>
                </div>
              ) : (
                <>
                  <p className="muted" title={workspace.path}>
                    {workspace.path}
                  </p>
                  <Tree
                    entries={workspace.tree}
                    open={(filePath) => void openWorkspaceFile(filePath)}
                    activePath={active.path}
                  />
                </>
              )}
            </section>
          )}
          {sidebar === 'outline' && (
            <section
              id="markora-sidebar-panel-outline"
              role="tabpanel"
              aria-labelledby="markora-sidebar-tab-outline"
              aria-label="Document outline"
            >
              {headingAnchors(active.model.text).map((heading) => (
                <button
                  className="outline-item"
                  style={{ paddingLeft: `${(heading.depth - 1) * 12 + 10}px` }}
                  key={`${heading.line}-${heading.id}`}
                  title={`Line ${heading.line}`}
                  onClick={() => openHeadingAtLine(heading.line)}
                >
                  H{heading.depth} {heading.text}
                </button>
              ))}
            </section>
          )}
          {sidebar === 'search' && (
            <section
              id="markora-sidebar-panel-search"
              role="tabpanel"
              aria-labelledby="markora-sidebar-tab-search"
            >
              {workspace ? (
                <WorkspaceSearchPanel
                  workspaceRoot={workspace.path}
                  onOpenResult={(filePath, line, column) => void openWorkspaceResult(filePath, line, column)}
                  onFilesChanged={() =>
                    void window.markora
                      .readTree(workspace.path)
                      .then((tree) => setWorkspace({ ...workspace, tree }))
                  }
                />
              ) : (
                <div className="sidebar-empty-state">
                  <div className="empty-icon">
                    <Search size={32} />
                  </div>
                  <h4>Search Workspace</h4>
                  <p>Open a folder first to search and replace text across all documents.</p>
                  <button className="empty-cta-btn" onClick={() => executeCommand('file.openFolder')}>
                    Open workspace
                  </button>
                </div>
              )}
            </section>
          )}
          {sidebar === 'settings' && (
            <section
              id="markora-sidebar-panel-settings"
              role="tabpanel"
              aria-labelledby="markora-sidebar-tab-settings"
              className="settings"
            >
              <button className="wide" type="button" onClick={() => setAppearanceOpen(true)}>
                Appearance and writing modes...
              </button>
              {restorePlan.length ? (
                <button className="wide" type="button" onClick={() => setRecoveryCenterOpen(true)}>
                  Recovery center ({restorePlan.length})...
                </button>
              ) : null}
              <p className="muted">
                Interface: {activeInterfaceTheme} · Document: {activeDocumentTheme} · {resolvedTheme}
                {appearance.writing.focusMode ? ' / Focus' : ''}
                {appearance.writing.typewriterMode ? ' / Typewriter' : ''}
                {appearance.writing.zenMode ? ' / Zen' : ''}
              </p>
              <label>
                Autosave seconds
                <input
                  type="number"
                  min="5"
                  max="600"
                  value={settings.autosaveSeconds}
                  onChange={(event) =>
                    setAndPersistSettings({ ...settings, autosaveSeconds: Number(event.target.value) || 15 })
                  }
                />
              </label>
              {spellcheckStatus && (
                <>
                  <label className="image-dialog-checkbox">
                    <input
                      type="checkbox"
                      checked={spellcheckStatus.enabled}
                      onChange={(event) => {
                        void window.markora
                          .configureSpellcheck({
                            enabled: event.target.checked,
                            languages: spellcheckStatus.languages,
                            userDictionary: spellcheckStatus.userDictionary,
                          })
                          .then(setSpellcheckStatus);
                      }}
                    />
                    Enable offline spell checking
                  </label>
                  <label>
                    Global spelling language
                    <select
                      value={spellcheckStatus.languages[0] || ''}
                      disabled={!spellcheckStatus.enabled}
                      onChange={(event) => {
                        void window.markora
                          .configureSpellcheck({
                            ...spellcheckStatus,
                            languages: event.target.value ? [event.target.value] : [],
                          })
                          .then(setSpellcheckStatus);
                      }}
                    >
                      {spellcheckStatus.availableLanguages.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Document spelling language
                    <select
                      value={active.spellLanguage || ''}
                      disabled={!spellcheckStatus.enabled}
                      onChange={(event) =>
                        updateDoc(active.id, { spellLanguage: event.target.value || undefined })
                      }
                    >
                      <option value="">Use global language</option>
                      {spellcheckStatus.availableLanguages.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="wide" onClick={() => setDictionaryDialogOpen(true)}>
                    Add dictionary word…
                  </button>
                </>
              )}
              <ShortcutSettingsPanel
                manager={shortcutManager}
                onRequestImport={() =>
                  new Promise<string | null>((resolve) => {
                    const picker = document.createElement('input');
                    picker.type = 'file';
                    picker.accept = 'application/json,.json';
                    picker.addEventListener(
                      'change',
                      () => {
                        const file = picker.files?.[0];
                        if (!file) resolve(null);
                        else void file.text().then(resolve, () => resolve(null));
                      },
                      { once: true },
                    );
                    picker.click();
                  })
                }
                onExport={(serialized, suggestedFileName) => {
                  const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = suggestedFileName;
                  link.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 0);
                }}
              />
            </section>
          )}
        </aside>

        <article
          id="markora-editor"
          className="editor-shell document-container"
          style={appearanceDocumentCssVariables(appearance, prefersDark, customThemes) as React.CSSProperties}
          role="tabpanel"
          {...(docs.length > 1
            ? { 'aria-labelledby': `markora-tab-${active.id}` }
            : { 'aria-label': 'Document editor' })}
          tabIndex={-1}
        >
          <div className={active.mode === 'source' ? 'mode-pane active' : 'mode-pane'}>
            <SourceEditor
              source={active.model.text}
              viewState={active.model.getViewSnapshot('source')}
              onChange={updateActiveContent}
              onViewStateChange={(state) => updateViewState('source', state)}
              onImageFiles={insertSourceImageFiles}
              spellcheckEnabled={spellcheckStatus?.enabled ?? true}
              language={active.spellLanguage || spellcheckStatus?.languages[0]}
              searchHighlights={documentHighlights}
              typewriterMode={appearance.writing.typewriterMode}
              wordWrap={appearance.writing.wordWrap}
            />
          </div>
          <div className={active.mode === 'structured' ? 'mode-pane active' : 'mode-pane'}>
            <StructuredEditor
              key={active.id}
              documentId={active.id}
              source={active.model.text}
              viewState={active.model.getViewSnapshot('structured')}
              onChange={updateActiveContent}
              onViewStateChange={(state) => updateViewState('structured', state)}
              onRequestImage={openImageDialog}
              onOpenLink={(href) => void openDocumentLink(href)}
              onImageFiles={importImageFiles}
              spellcheckEnabled={spellcheckStatus?.enabled ?? true}
              language={active.spellLanguage || spellcheckStatus?.languages[0]}
              searchHighlights={documentHighlights}
              onCommand={(id) => executeCommand(id)}
              onHandle={setStructuredEditorHandle}
              onTableActiveChange={setStructuredTableActive}
              typewriterMode={appearance.writing.typewriterMode}
            />
          </div>
        </article>
      </div>

      <DocumentSearchPanel
        key={`${active.id}-${documentReplaceMode ? 'replace' : 'find'}`}
        open={documentSearchOpen}
        documentText={active.model.text}
        selection={
          active.mode === 'source'
            ? {
                start: Math.min(
                  active.model.getViewSnapshot('source').anchor,
                  active.model.getViewSnapshot('source').head,
                ),
                end: Math.max(
                  active.model.getViewSnapshot('source').anchor,
                  active.model.getViewSnapshot('source').head,
                ),
              }
            : structuredEditorRef.current?.getMarkdownSelection(active.model.text)
        }
        initialReplaceMode={documentReplaceMode}
        initialHistory={documentSearchHistory}
        onClose={() => {
          setDocumentSearchOpen(false);
          setDocumentHighlights(undefined);
        }}
        onNavigate={({ match }) => {
          const current = active.model.getViewSnapshot('source');
          active.model.setViewSnapshot('source', {
            ...current,
            anchor: match.start,
            head: match.end,
          });
          setDocs((items) =>
            items.map((document) => (document.id === active.id ? { ...document } : document)),
          );
        }}
        onHighlightsChange={setDocumentHighlights}
        onApplyReplacement={(replacement) => {
          active.model.setText(replacement.text);
          const last = replacement.insertedRanges.at(-1);
          if (last) {
            const current = active.model.getViewSnapshot('source');
            active.model.setViewSnapshot('source', {
              ...current,
              anchor: last.start,
              head: last.end,
            });
          }
          setDocs((items) =>
            items.map((document) => (document.id === active.id ? { ...document } : document)),
          );
        }}
        onHistoryChange={(history) => {
          setDocumentSearchHistory(history);
          try {
            localStorage.setItem('markora.documentSearchHistory', serializeSearchHistory(history));
          } catch {
            /* Search still works when storage is unavailable. */
          }
        }}
      />
      <TableInsertDialog
        open={tableInsertOpen}
        onInsert={insertTable}
        onClose={() => setTableInsertOpen(false)}
      />
      <TextInputDialog
        open={sourceLinkDialog !== null}
        title="Edit link"
        description="Enter a URL, relative path, email address, or heading anchor."
        label="Link destination"
        initialValue={sourceLinkDialog?.initialValue}
        placeholder="https:// or ./document.md"
        submitLabel="Apply link"
        allowEmpty
        validate={validateLinkDestination}
        onRemove={
          sourceLinkDialog?.canRemove
            ? () => {
                const pending = sourceLinkDialog;
                if (!pending) return;
                const document = docsRef.current.find((candidate) => candidate.id === pending.documentId);
                if (document) {
                  document.model.replaceText(pending.start, pending.end, pending.label);
                  setDocs((items) =>
                    items.map((candidate) =>
                      candidate.id === pending.documentId ? { ...candidate } : candidate,
                    ),
                  );
                }
                setSourceLinkDialog(null);
              }
            : undefined
        }
        onSubmit={(value) => {
          const pending = sourceLinkDialog;
          if (!pending) return;
          const document = docsRef.current.find((candidate) => candidate.id === pending.documentId);
          if (!document) {
            setSourceLinkDialog(null);
            return;
          }
          const label = pending.label.replace(/\]/gu, '\\]');
          const destination = value.includes(' ') ? `<${value}>` : value;
          const replacement = value ? `[${label}](${destination})` : pending.label;
          document.model.replaceText(pending.start, pending.end, replacement);
          const snapshot = document.model.getViewSnapshot('source');
          document.model.setViewSnapshot('source', {
            ...snapshot,
            anchor: pending.start,
            head: pending.start + replacement.length,
          });
          setDocs((items) =>
            items.map((candidate) => (candidate.id === pending.documentId ? { ...candidate } : candidate)),
          );
          setSourceLinkDialog(null);
        }}
        onClose={() => setSourceLinkDialog(null)}
      />
      <TextInputDialog
        open={dictionaryDialogOpen}
        title="Add dictionary word"
        description="The word is stored locally in your Markora profile and is never sent to an online service."
        label="Word"
        submitLabel="Add word"
        onSubmit={(word) => {
          setDictionaryDialogOpen(false);
          void window.markora
            .addToDictionary(word)
            .then(() => window.markora.getSpellcheckStatus())
            .then((status) => {
              setSpellcheckStatus(status);
              setAnnouncement(`${word} was added to the dictionary.`);
            })
            .catch((error) => {
              window.alert(
                `Dictionary update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            });
        }}
        onClose={() => setDictionaryDialogOpen(false)}
      />
      <ConflictDialog
        open={Boolean(diskConflict)}
        conflict={diskConflict}
        onResolve={resolveDiskConflict}
        onClose={() => {
          void resolveDiskConflict('keep').catch((error) => {
            window.alert(
              `Recovery snapshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          });
        }}
      />
      <RecoveryCenterDialog
        open={recoveryCenterOpen}
        items={restorePlan}
        onRestore={restoreDocuments}
        onDiscard={discardRecoveryItems}
        onClose={() => setRecoveryCenterOpen(false)}
      />
      <CommandPalette
        open={commandPaletteOpen}
        registry={commandRegistry}
        context={commandContextRef.current}
        shortcuts={shortcutManager}
        onClose={() => setCommandPaletteOpen(false)}
        onExecutionError={(error) => {
          window.alert(error instanceof Error ? error.message : 'The command failed.');
        }}
      />
      <AppearancePanel
        open={appearanceOpen}
        settings={appearance}
        prefersDark={prefersDark}
        onChange={setAndPersistAppearanceFromPanel}
        onClose={() => setAppearanceOpen(false)}
        onFullscreenChange={(enabled) => {
          void setFullscreen(enabled).catch((error) => {
            window.alert(`Full screen failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          });
        }}
        onRequestImport={() =>
          new Promise<string | null>((resolve) => {
            const picker = document.createElement('input');
            picker.type = 'file';
            picker.accept = 'application/json,.json';
            picker.addEventListener(
              'change',
              () => {
                const file = picker.files?.[0];
                if (!file) resolve(null);
                else void file.text().then(resolve, () => resolve(null));
              },
              { once: true },
            );
            picker.click();
          })
        }
        onRequestExport={(serialized) => {
          const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'markora-appearance.json';
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 0);
        }}
        customThemes={customThemes}
        onImportCustomTheme={importCustomTheme}
        onDuplicateCustomTheme={duplicateCustomTheme}
        onDeleteCustomTheme={deleteCustomTheme}
        onExportCustomTheme={exportCustomTheme}
        onSaveCustomTheme={saveCustomTheme}
      />
      <HtmlExportDialog
        open={htmlExportOpen}
        defaultTitle={active.name.replace(/\.md(?:own)?$/i, '')}
        onClose={() => setHtmlExportOpen(false)}
        onPreview={(options) => window.markora.previewHtmlExport(createHtmlExportRequest(options))}
        onExport={(options) => window.markora.exportHtml(createHtmlExportRequest(options))}
      />
      {pdfExportDocument ? (
        <PdfExportDialog
          open={pdfExportOpen}
          document={pdfExportDocument}
          initialOptions={{
            title: active.name.replace(/\.md(?:own)?$/i, ''),
            printTheme: resolvedTheme,
            lightThemeOverride: false,
          }}
          onClose={() => setPdfExportOpen(false)}
        />
      ) : null}
      {pendingChord ? (
        <div className="chord-status" role="status" aria-live="polite">
          Waiting for chord: <kbd>{pendingChord}</kbd>
        </div>
      ) : null}
      <footer className="status-bar" data-markora-region="statusBar" role="status" aria-live="polite">
        <span>{active.path || 'Unsaved document'}</span>
        <span className="statusBar-stats">
          {statistics.words} words · {statistics.chars} chars
        </span>
        <span
          className="statusBar-theme"
          title={`Interface theme: ${activeInterfaceTheme}; document theme: ${activeDocumentTheme}`}
          aria-label={`Active theme: ${activeInterfaceTheme}; document theme: ${activeDocumentTheme}`}
        >
          Theme: {activeInterfaceTheme}
          {activeDocumentTheme !== activeInterfaceTheme ? ` · Doc: ${activeDocumentTheme}` : ''}
        </span>
        <span className="statusBar-mode-switcher segmented-control">
          <button
            type="button"
            className={`statusBar-mode-btn ${active.mode !== 'source' ? 'active' : ''}`}
            onClick={() => {
              if (active.mode === 'source') {
                const policy = documentModePolicy(active.model.text);
                if (!policy.structuredModeAllowed) {
                  setAnnouncement(policy.reason ?? 'This document is too large for Structured Mode.');
                  window.alert(policy.reason);
                  return;
                }
                updateDoc(active.id, { mode: 'structured' });
              }
            }}
          >
            Structured
          </button>
          <button
            type="button"
            className={`statusBar-mode-btn ${active.mode === 'source' ? 'active' : ''}`}
            onClick={() => {
              if (active.mode !== 'source') {
                updateDoc(active.id, { mode: 'source' });
              }
            }}
          >
            Source
          </button>
        </span>
        <span>{active.model.lineEnding.toUpperCase()} · UTF-8</span>
      </footer>
      <ImageDialog
        open={imageDialog.open}
        operation={imageDialog.target ? 'edit' : 'insert'}
        initialValue={
          imageDialog.target
            ? {
                ...imageDialog.target,
                sourceKind: /^https?:\/\//i.test(imageDialog.target.src) ? 'url' : 'file',
                destination: 'keep-original',
              }
            : undefined
        }
        documentSaved={Boolean(active.path)}
        workspaceAvailable={Boolean(workspace)}
        onChooseFile={() => window.markora.pickImageFile()}
        onSubmit={(result) => void applyImage(result)}
        actions={
          imageDialog.target
            ? /^https?:\/\//i.test(imageDialog.target.src)
              ? ['open', 'copy-path', 'localize', 'remove']
              : ['reveal', 'open', 'copy-path', 'copy-image', 'remove']
            : []
        }
        onAction={(action) => void runImageAction(action)}
        onCancel={() => {
          if (imageOperationId) void window.markora.cancelImageOperation(imageOperationId);
          setImageDialog({ open: false });
        }}
      />
      <PandocDialog
        open={pandocOpen}
        status={pandocStatus}
        conversion={pandocConversion}
        onChooseExecutable={async () => {
          const selected = await window.markora.pickPandocExecutable();
          return selected ? toPandocStatus(selected) : null;
        }}
        onExecutableSelected={setPandocStatus}
        onChooseInput={(format) => window.markora.pickPandocInput(format)}
        onChooseOutput={(format) =>
          window.markora.pickPandocOutput({
            format,
            title: active.name.replace(/\.md(?:own)?$/i, ''),
          })
        }
        onRequestImportPreview={previewPandocImport}
        onConvert={(request) => void convertWithPandoc(request)}
        onCancelConversion={() => {
          if (pandocOperationId) void window.markora.cancelPandoc(pandocOperationId);
        }}
        onClose={() => {
          if (pandocConversion.state !== 'running') {
            setPandocOpen(false);
            setPandocConversion({ state: 'idle' });
          }
        }}
      />
    </main>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
