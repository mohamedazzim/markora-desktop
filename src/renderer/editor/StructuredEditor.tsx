import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import mermaid from 'mermaid';
import katex from 'katex';
import { markdownToStructuredHtml, structuredHtmlToMarkdown } from '../markdown/transform';
import type { EditorViewSnapshot } from './SourceEditor';
import type { ImageOptions } from '../images/image-utils';
import type { SearchHighlightData } from '../search/DocumentSearchPanel';
import type { TextRange } from '../search/document-search';
import type { BaselineCommandId } from '../commands';
import type { WritingNavigationCommand } from '../appearance/writing-navigation';
import type { MermaidTheme } from '../appearance/appearance-settings';
import { TextInputDialog, validateLinkDestination } from './TextInputDialog';
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, Highlighter, Eraser } from 'lucide-react';

interface StructuredSearchRange {
  from: number;
  to: number;
  active: boolean;
}

interface StructuredTextSegment {
  readonly markdownStart: number;
  readonly markdownEnd: number;
  readonly structuredStart: number;
  readonly structuredEnd: number;
}
const structuredSearchKey = new PluginKey<DecorationSet>('markora-search-highlights');
const StructuredSearchHighlights = Extension.create({
  name: 'markoraSearchHighlights',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: structuredSearchKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, current) => {
            const payload = transaction.getMeta(structuredSearchKey) as StructuredSearchRange[] | undefined;
            if (payload) {
              return DecorationSet.create(
                transaction.doc,
                payload.map((range) =>
                  Decoration.inline(range.from, range.to, {
                    class: range.active ? 'structured-search-match active' : 'structured-search-match',
                  }),
                ),
              );
            }
            return current.map(transaction.mapping, transaction.doc);
          },
        },
        props: { decorations: (state) => structuredSearchKey.getState(state) },
      }),
    ];
  },
});

const StructuredActiveBlock = Extension.create({
  name: 'markoraActiveBlock',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              const active = state.selection.from >= offset && state.selection.from <= offset + node.nodeSize;
              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  'data-markora-block': 'true',
                  'data-markora-active': active ? 'true' : 'false',
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function FenceNodeView({ node, deleteNode }: NodeViewProps) {
  const [visual, setVisual] = useState('');
  const [error, setError] = useState('');
  const [diagramTheme, setDiagramTheme] = useState<MermaidTheme>('neutral');
  const [isEditing, setIsEditing] = useState(!node.textContent);
  const outputId = useRef(`markora-diagram-${crypto.randomUUID()}`);
  const kind = String(node.attrs.kind || 'mermaid');
  const source = node.textContent;
  useEffect(() => {
    const update = (event: Event) => {
      const theme = (event as CustomEvent<MermaidTheme>).detail;
      if (['default', 'neutral', 'dark', 'forest', 'base'].includes(theme)) setDiagramTheme(theme);
    };
    window.addEventListener('markora-mermaid-theme', update);
    return () => window.removeEventListener('markora-mermaid-theme', update);
  }, []);
  useEffect(() => {
    let alive = true;
    if (!['math', 'displaymath', 'mermaid'].includes(kind)) {
      setVisual(
        `<pre>${source.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)}</pre>`,
      );
      setError('');
      return () => {
        alive = false;
      };
    }
    if (kind === 'math' || kind === 'displaymath') {
      try {
        if (alive) setVisual(katex.renderToString(source, { displayMode: true, throwOnError: false }));
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Math could not be rendered.');
      }
      return () => {
        alive = false;
      };
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: diagramTheme });
    mermaid
      .render(outputId.current, source)
      .then(({ svg }) => {
        if (alive) {
          setVisual(svg);
          setError('');
        }
      })
      .catch((cause) => {
        if (alive) {
          setVisual('');
          setError(cause instanceof Error ? cause.message : 'Diagram could not be rendered.');
        }
      });
    return () => {
      alive = false;
    };
  }, [diagramTheme, kind, source]);

  const handleCopyRaw = () => {
    void navigator.clipboard.writeText(source);
  };

  return (
    <NodeViewWrapper className={`fence-node ${kind} block-context-node`}>
      <div className="block-context-bar">
        <span className="block-label">{kind.toUpperCase()}</span>
        <div className="block-actions">
          <button type="button" onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? 'View Preview' : 'Edit Source'}
          </button>
          <button type="button" onClick={handleCopyRaw}>
            Copy Raw
          </button>
          <button type="button" className="delete-btn" onClick={deleteNode}>
            Delete
          </button>
        </div>
      </div>

      {!isEditing ? (
        <div
          className="fence-preview"
          role="img"
          aria-label={`${kind} preview`}
          aria-busy={!visual && !error}
        >
          {visual ? (
            <div dangerouslySetInnerHTML={{ __html: visual }} />
          ) : (
            <span className="fence-error" role={error ? 'alert' : 'status'}>
              {error || 'Rendering…'}
            </span>
          )}
        </div>
      ) : (
        <NodeViewContent className="fence-source" />
      )}
    </NodeViewWrapper>
  );
}

function CodeBlockNodeView({ node, updateAttributes }: NodeViewProps) {
  const language = String(node.attrs.language || 'text');
  const code = node.textContent;

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateAttributes({ language: event.target.value });
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
  };

  return (
    <NodeViewWrapper className="code-block-node">
      <div className="code-block-header">
        <select value={language} onChange={handleLanguageChange}>
          <option value="text">Plain Text</option>
          <option value="markdown">Markdown</option>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="sql">SQL</option>
          <option value="json">JSON</option>
        </select>
        <button type="button" onClick={handleCopy}>
          Copy
        </button>
      </div>
      <pre>
        <NodeViewContent as="div" />
      </pre>
    </NodeViewWrapper>
  );
}

const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});

const MarkoraFence = Node.create({
  name: 'markoraFence',
  group: 'block',
  content: 'text*',
  code: true,
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'mermaid',
        parseHTML: (element) => element.getAttribute('data-markora-fence') || 'mermaid',
        renderHTML: (attributes) => ({ 'data-markora-fence': attributes.kind }),
      },
      delimiter: {
        default: '---',
        parseHTML: (element) => element.getAttribute('data-markora-delimiter') || '---',
        renderHTML: (attributes) =>
          attributes.kind === 'frontmatter' ? { 'data-markora-delimiter': attributes.delimiter } : {},
      },
    };
  },
  parseHTML() {
    // Run before the generic CodeBlock rule so persisted math/Mermaid/raw
    // fences are mounted as their rendering node instead of a plain code block.
    return [{ tag: 'pre[data-markora-fence]', priority: 1_000 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FenceNodeView);
  },
});

const parseAlignment = (element: HTMLElement) => {
  const value = (
    element.getAttribute('data-align') ||
    element.getAttribute('align') ||
    element.style.textAlign
  ).toLowerCase();
  return ['left', 'center', 'right'].includes(value) ? value : null;
};

const alignmentAttribute = {
  default: null,
  parseHTML: parseAlignment,
  renderHTML: (attributes: Record<string, unknown>) => {
    const alignment = String(attributes.alignment || '');
    return ['left', 'center', 'right'].includes(alignment)
      ? { 'data-align': alignment, style: `text-align: ${alignment}` }
      : {};
  },
};

const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), alignment: alignmentAttribute };
  },
});

const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), alignment: alignmentAttribute };
  },
});

const EditableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null, parseHTML: (element) => element.getAttribute('title') },
      width: { default: null, parseHTML: (element) => element.getAttribute('width') },
      height: { default: null, parseHTML: (element) => element.getAttribute('height') },
      alignment: alignmentAttribute,
    };
  },
});

const extensions = [
  StarterKit.configure({
    codeBlock: false,
    link: false,
    underline: false,
  }),
  CustomCodeBlock,
  Underline,
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  EditableImage.configure({ inline: false, allowBase64: false }),
  Table.configure({ resizable: true }),
  TableRow,
  AlignedTableHeader,
  AlignedTableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  MarkoraFence,
  StructuredSearchHighlights,
  StructuredActiveBlock,
];

function navigateToolbar(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])'),
  );
  if (!controls.length) return;
  const currentIndex = Math.max(0, controls.indexOf(document.activeElement as HTMLElement));
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
  event.preventDefault();
  controls[nextIndex]?.focus();
}

function insertTable(editor: Editor, rows: number, columns: number): boolean {
  return editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run();
}

function insertFence(editor: Editor, kind: 'mermaid' | 'math'): boolean {
  return editor
    .chain()
    .focus()
    .insertContent({
      type: 'markoraFence',
      attrs: { kind },
      content: [
        { type: 'text', text: kind === 'mermaid' ? 'flowchart LR\n  Draft --> Publish' : 'E = mc^2' },
      ],
    })
    .run();
}

async function copyTable(editor: Editor, tabSeparated: boolean): Promise<boolean> {
  const table = editor.view.dom.querySelector('table');
  if (!table) return false;
  const text = tabSeparated
    ? Array.from(table.querySelectorAll('tr'))
        .map((row) =>
          Array.from(row.querySelectorAll('th,td'))
            .map((cell) => cell.textContent?.trim() || '')
            .join('\t'),
        )
        .join('\n')
    : structuredHtmlToMarkdown(table.outerHTML);
  await navigator.clipboard.writeText(text);
  return true;
}

function candidateOccurrences(source: string, candidate: string): number[] {
  if (!candidate) return [];
  const positions: number[] = [];
  for (let offset = source.indexOf(candidate); offset >= 0; offset = source.indexOf(candidate, offset + 1)) {
    positions.push(offset);
  }
  return positions;
}

/**
 * Aligns visible ProseMirror text nodes with their canonical Markdown ranges. Markdown delimiters are
 * intentionally left between segments, so selections and search hits remain expressed in canonical
 * source offsets without pretending that invisible syntax has a ProseMirror position.
 */
function structuredTextSegments(editor: Editor, source: string): StructuredTextSegment[] {
  const segments: StructuredTextSegment[] = [];
  let markdownCursor = 0;
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const markdownStart = source.indexOf(node.text, markdownCursor);
    if (markdownStart < 0) return;
    segments.push({
      markdownStart,
      markdownEnd: markdownStart + node.text.length,
      structuredStart: position,
      structuredEnd: position + node.nodeSize,
    });
    markdownCursor = markdownStart + node.text.length;
  });
  return segments;
}

function structuredRangeForMarkdown(
  segments: readonly StructuredTextSegment[],
  range: TextRange,
): Omit<StructuredSearchRange, 'active'> | null {
  const overlaps = segments.filter(
    (segment) => segment.markdownEnd > range.start && segment.markdownStart < range.end,
  );
  const first = overlaps[0];
  const last = overlaps.at(-1);
  if (!first || !last) return null;
  const from = first.structuredStart + Math.max(0, range.start - first.markdownStart);
  const to = last.structuredStart + Math.min(last.markdownEnd, range.end) - last.markdownStart;
  return to > from ? { from, to } : null;
}

/** Maps a ProseMirror selection back to the canonical Markdown when it can be identified safely. */
function markdownSelection(editor: Editor, source: string): TextRange | undefined {
  const { from, to } = editor.state.selection;
  if (from === to) return undefined;
  const overlaps = structuredTextSegments(editor, source).filter(
    (segment) => segment.structuredEnd > from && segment.structuredStart < to,
  );
  const first = overlaps[0];
  const last = overlaps.at(-1);
  if (first && last) {
    const start = first.markdownStart + Math.max(0, from - first.structuredStart);
    const end = last.markdownStart + Math.min(last.structuredEnd, to) - last.structuredStart;
    if (end > start) return { start, end };
  }

  // Custom/atom nodes do not always expose alignable text nodes. Retain a conservative serialized
  // fragment fallback for those selections, choosing the nearest duplicate to the structured cursor.
  const wrapper = document.createElement('div');
  wrapper.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.selection.content().content),
  );
  const serialized = structuredHtmlToMarkdown(wrapper.innerHTML);
  const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n');
  const candidates = [serialized, serialized.trimEnd(), selectedText]
    .map((candidate) => candidate.trimStart())
    .filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);
  const expected = (from / Math.max(1, editor.state.doc.content.size)) * source.length;
  for (const candidate of candidates) {
    const positions = candidateOccurrences(source, candidate);
    if (!positions.length) continue;
    const start = positions.reduce((closest, position) =>
      Math.abs(position - expected) < Math.abs(closest - expected) ? position : closest,
    );
    return { start, end: start + candidate.length };
  }
  return undefined;
}

export interface StructuredEditorHandle {
  toggleBold(): boolean;
  toggleItalic(): boolean;
  insertTable(rows: number, columns: number): boolean;
  executeCommand(id: StructuredEditorCommandId): boolean | Promise<boolean>;
  /** Execute inside the editor without re-entering the application command registry. */
  executeCommandLocal(id: StructuredEditorCommandId): boolean | Promise<boolean>;
  getMarkdownSelection(source: string): TextRange | undefined;
  setTextSelection(from: number, to: number): boolean;
  focus(): void;
  navigate(command: WritingNavigationCommand): boolean;
}

export type StructuredEditorCommandId = Extract<
  BaselineCommandId,
  | 'editor.undo'
  | 'editor.redo'
  | 'editor.toggleBold'
  | 'editor.toggleItalic'
  | 'editor.toggleStrike'
  | 'editor.toggleUnderline'
  | 'editor.toggleHighlight'
  | 'editor.editLink'
  | 'editor.setParagraph'
  | 'editor.setHeading1'
  | 'editor.setHeading2'
  | 'editor.setHeading3'
  | 'editor.setHeading4'
  | 'editor.setHeading5'
  | 'editor.setHeading6'
  | 'editor.toggleBulletList'
  | 'editor.toggleOrderedList'
  | 'editor.toggleTaskList'
  | 'editor.toggleBlockquote'
  | 'editor.toggleCodeBlock'
  | 'editor.insertImage'
  | 'editor.insertTable'
  | 'editor.insertMath'
  | 'editor.insertMermaid'
  | 'table.addRowBefore'
  | 'table.addRowAfter'
  | 'table.addColumnBefore'
  | 'table.addColumnAfter'
  | 'table.deleteRow'
  | 'table.deleteColumn'
  | 'table.copyMarkdown'
  | 'table.copyTsv'
  | 'table.delete'
>;

export interface StructuredEditorProps {
  documentId: string;
  source: string;
  viewState: EditorViewSnapshot;
  onChange(markdown: string): void;
  onViewStateChange(state: EditorViewSnapshot): void;
  onRequestImage?(image?: ImageOptions): void;
  onOpenLink?(href: string): void;
  onImageFiles?(files: File[]): Promise<ImageOptions[]>;
  spellcheckEnabled?: boolean;
  language?: string;
  searchHighlights?: SearchHighlightData;
  onCommand?(id: StructuredEditorCommandId): void;
  onHandle?(handle: StructuredEditorHandle | null): void;
  onTableActiveChange?(active: boolean): void;
  typewriterMode?: boolean;
}
export function StructuredEditor({
  documentId,
  source,
  viewState,
  onChange,
  onViewStateChange,
  onRequestImage,
  onOpenLink,
  onImageFiles,
  spellcheckEnabled = true,
  language,
  searchHighlights,
  onCommand,
  onHandle,
  onTableActiveChange,
  typewriterMode = false,
}: StructuredEditorProps) {
  const lastEmittedRef = useRef<string | null>(null);
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const onViewStateChangeRef = useRef(onViewStateChange);
  onViewStateChangeRef.current = onViewStateChange;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const typewriterModeRef = useRef(typewriterMode);
  typewriterModeRef.current = typewriterMode;
  const [tableActive, setTableActive] = useState(false);
  const [inputDialog, setInputDialog] = useState<
    | { kind: 'link'; initialValue: string; canRemove: boolean }
    | { kind: 'image'; initialValue: string; canRemove?: false }
    | null
  >(null);

  const [floatingMenu, setFloatingMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });

  const commandsList = [
    {
      label: 'Heading 1',
      description: 'Large section heading',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      description: 'Medium section heading',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Heading 3',
      description: 'Small section heading',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: 'Bulleted List',
      description: 'Create a simple bulleted list',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered List',
      description: 'Create a list with numbering',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Task List',
      description: 'Track tasks with checkboxes',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleTaskList().run(),
    },
    {
      label: 'Block Quote',
      description: 'Capture a quote block',
      category: 'Basic',
      action: (ed: Editor) => ed.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Code Block',
      description: 'Write code with language highlighting',
      category: 'Advanced',
      action: (ed: Editor) => ed.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: 'Table',
      description: 'Insert a 3x3 table grid',
      category: 'Advanced',
      action: (ed: Editor) => insertTable(ed, 3, 3),
    },
    {
      label: 'Math Block',
      description: 'Render mathematical formulas',
      category: 'Advanced',
      action: (ed: Editor) =>
        ed
          .chain()
          .focus()
          .insertContent({ type: 'markoraFence', attrs: { kind: 'math' } })
          .run(),
    },
    {
      label: 'Mermaid Diagram',
      description: 'Draw flowcharts and charts',
      category: 'Advanced',
      action: (ed: Editor) =>
        ed
          .chain()
          .focus()
          .insertContent({ type: 'markoraFence', attrs: { kind: 'mermaid' } })
          .run(),
    },
  ];

  const [slashMenu, setSlashMenu] = useState<{
    visible: boolean;
    query: string;
    x: number;
    y: number;
    selectedIndex: number;
  }>({ visible: false, query: '', x: 0, y: 0, selectedIndex: 0 });

  const slashMenuRef = useRef(slashMenu);
  slashMenuRef.current = slashMenu;

  const filteredCommands = commandsList.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(slashMenu.query) ||
      cmd.description.toLowerCase().includes(slashMenu.query),
  );

  const filteredCommandsRef = useRef(filteredCommands);
  filteredCommandsRef.current = filteredCommands;

  const handleSelectCommand = (cmd: (typeof commandsList)[number], instance: Editor) => {
    const { state } = instance;
    const { $from } = state.selection;
    instance.chain().focus().deleteRange({ from: $from.start(), to: $from.end() }).run();
    cmd.action(instance);
    setSlashMenu({ visible: false, query: '', x: 0, y: 0, selectedIndex: 0 });
  };

  const checkSlashMenu = (instance: Editor) => {
    const { selection } = instance.state;
    const { $from } = selection;
    const parent = $from.parent;
    if (parent.type.name === 'paragraph' && parent.textContent.startsWith('/')) {
      const query = parent.textContent.slice(1).toLowerCase();
      try {
        const coords = instance.view.coordsAtPos($from.pos);
        setSlashMenu((prev) => ({
          visible: true,
          query,
          x: coords.left,
          y: coords.bottom + 4,
          selectedIndex: prev.visible && prev.query === query ? prev.selectedIndex : 0,
        }));
      } catch {
        // The editor can be detached while the selection is changing.
      }
    } else {
      setSlashMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    }
  };

  const editor = useEditor({
    extensions,
    content: markdownToStructuredHtml(source),
    editorProps: {
      attributes: {
        class: 'structured-prosemirror',
        'aria-label': 'Structured Markdown editor',
        spellcheck: spellcheckEnabled ? 'true' : 'false',
        ...(language ? { lang: language } : {}),
      },
      handleDoubleClickOn: (_view, _position, node) => {
        if (node.type.name !== 'image' || !onRequestImage) return false;
        onRequestImage({
          src: String(node.attrs.src || ''),
          alt: node.attrs.alt ? String(node.attrs.alt) : '',
          title: node.attrs.title ? String(node.attrs.title) : undefined,
          width: node.attrs.width ? Number(node.attrs.width) : undefined,
          height: node.attrs.height ? Number(node.attrs.height) : undefined,
          preserveAspectRatio: true,
          alignment: node.attrs.alignment || 'default',
        });
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        const href = target?.getAttribute('href');
        if (!href || !onOpenLinkRef.current) return false;
        event.preventDefault();
        onOpenLinkRef.current(href);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const linkMark = view.state.schema.marks.link;
          const href = linkMark
            ? (view.state.selection.$from.marks().find((mark) => mark.type === linkMark)?.attrs.href as
                string | undefined)
            : undefined;
          if (href && onOpenLinkRef.current) {
            event.preventDefault();
            onOpenLinkRef.current(href);
            return true;
          }
        }
        if (slashMenuRef.current.visible) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSlashMenu((prev) => ({
              ...prev,
              selectedIndex: (prev.selectedIndex + 1) % filteredCommandsRef.current.length,
            }));
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSlashMenu((prev) => ({
              ...prev,
              selectedIndex:
                (prev.selectedIndex - 1 + filteredCommandsRef.current.length) %
                filteredCommandsRef.current.length,
            }));
            return true;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const cmd = filteredCommandsRef.current[slashMenuRef.current.selectedIndex];
            if (cmd) {
              handleSelectCommand(cmd, editor!);
            }
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setSlashMenu({ visible: false, query: '', x: 0, y: 0, selectedIndex: 0 });
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      const next = structuredHtmlToMarkdown(instance.getHTML());
      lastEmittedRef.current = next;
      onChange(next);
      setTableActive(instance.isActive('table'));
      checkSlashMenu(instance);
    },
    onSelectionUpdate: ({ editor: instance }) => {
      setTableActive(instance.isActive('table'));
      const container = instance.view.dom.closest('.structured-editor');
      onViewStateChangeRef.current({
        anchor: instance.state.selection.anchor,
        head: instance.state.selection.head,
        scrollTop: container instanceof HTMLElement ? container.scrollTop : viewStateRef.current.scrollTop,
        scrollLeft: container instanceof HTMLElement ? container.scrollLeft : viewStateRef.current.scrollLeft,
      });
      if (typewriterModeRef.current) {
        window.requestAnimationFrame(() => {
          if (!(container instanceof HTMLElement)) return;
          const bounds = container.getBoundingClientRect();
          const cursor = instance.view.coordsAtPos(instance.state.selection.head);
          container.scrollTop += cursor.top - bounds.top - bounds.height / 2;
        });
      }
      checkSlashMenu(instance);
    },
  });

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { state, view } = editor;
      const { selection } = state;

      if (selection.empty || !selection.content().size) {
        setFloatingMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }

      try {
        const { from, to } = selection;
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);

        const top = Math.min(start.top, end.top) - 10;
        const left = (start.left + end.left) / 2;

        setFloatingMenu({
          visible: true,
          x: left,
          y: top,
        });
      } catch {
        // coordsAtPos might throw if position is not rendered/visible
      }
    };

    const handleScroll = () => {
      if (editor.state.selection.empty) return;
      handleSelectionUpdate();
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('focus', handleSelectionUpdate);
    editor.on('blur', handleSelectionUpdate);

    const scroller = editor.view.dom.closest('.structured-editor');
    if (scroller) {
      scroller.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('focus', handleSelectionUpdate);
      editor.off('blur', handleSelectionUpdate);
      if (scroller) {
        scroller.removeEventListener('scroll', handleScroll);
      }
    };
  }, [editor]);
  const executeEditorCommand = useCallback(
    (id: StructuredEditorCommandId): boolean | Promise<boolean> => {
      if (!editor) return false;
      switch (id) {
        case 'editor.undo':
          return editor.chain().focus().undo().run();
        case 'editor.redo':
          return editor.chain().focus().redo().run();
        case 'editor.toggleBold':
          return editor.chain().focus().toggleBold().run();
        case 'editor.toggleItalic':
          return editor.chain().focus().toggleItalic().run();
        case 'editor.toggleStrike':
          return editor.chain().focus().toggleStrike().run();
        case 'editor.toggleUnderline':
          return editor.chain().focus().toggleUnderline().run();
        case 'editor.toggleHighlight':
          return editor.chain().focus().toggleHighlight().run();
        case 'editor.editLink': {
          const prior = editor.getAttributes('link').href as string | undefined;
          setInputDialog({ kind: 'link', initialValue: prior ?? 'https://', canRemove: Boolean(prior) });
          return true;
        }
        case 'editor.setParagraph':
          return editor.chain().focus().setParagraph().run();
        case 'editor.setHeading1':
          return editor.chain().focus().setHeading({ level: 1 }).run();
        case 'editor.setHeading2':
          return editor.chain().focus().setHeading({ level: 2 }).run();
        case 'editor.setHeading3':
          return editor.chain().focus().setHeading({ level: 3 }).run();
        case 'editor.setHeading4':
          return editor.chain().focus().setHeading({ level: 4 }).run();
        case 'editor.setHeading5':
          return editor.chain().focus().setHeading({ level: 5 }).run();
        case 'editor.setHeading6':
          return editor.chain().focus().setHeading({ level: 6 }).run();
        case 'editor.toggleBulletList':
          return editor.chain().focus().toggleBulletList().run();
        case 'editor.toggleOrderedList':
          return editor.chain().focus().toggleOrderedList().run();
        case 'editor.toggleTaskList':
          return editor.chain().focus().toggleTaskList().run();
        case 'editor.toggleBlockquote':
          return editor.chain().focus().toggleBlockquote().run();
        case 'editor.toggleCodeBlock':
          return editor.chain().focus().toggleCodeBlock().run();
        case 'editor.insertImage':
          if (onRequestImage) onRequestImage();
          else setInputDialog({ kind: 'image', initialValue: '' });
          return true;
        case 'editor.insertTable':
          return insertTable(editor, 3, 3);
        case 'editor.insertMath':
          return insertFence(editor, 'math');
        case 'editor.insertMermaid':
          return insertFence(editor, 'mermaid');
        case 'table.addRowBefore':
          return editor.chain().focus().addRowBefore().run();
        case 'table.addRowAfter':
          return editor.chain().focus().addRowAfter().run();
        case 'table.addColumnBefore':
          return editor.chain().focus().addColumnBefore().run();
        case 'table.addColumnAfter':
          return editor.chain().focus().addColumnAfter().run();
        case 'table.deleteRow':
          return editor.chain().focus().deleteRow().run();
        case 'table.deleteColumn':
          return editor.chain().focus().deleteColumn().run();
        case 'table.copyMarkdown':
          return copyTable(editor, false);
        case 'table.copyTsv':
          return copyTable(editor, true);
        case 'table.delete':
          return editor.chain().focus().deleteTable().run();
      }
    },
    [editor, onRequestImage],
  );
  useEffect(() => {
    const handle: StructuredEditorHandle = {
      toggleBold: () => editor?.chain().focus().toggleBold().run() ?? false,
      toggleItalic: () => editor?.chain().focus().toggleItalic().run() ?? false,
      insertTable: (rows, columns) => (editor ? insertTable(editor, rows, columns) : false),
      executeCommand: (id) => {
        if (onCommand) {
          onCommand(id);
          // The application registry owns normal commands. Inserting a table also
          // needs to update this editor immediately so its contextual controls mount.
          if (id !== 'editor.insertTable') return true;
        }
        return executeEditorCommand(id);
      },
      executeCommandLocal: (id) => executeEditorCommand(id),
      getMarkdownSelection: (source) => (editor ? markdownSelection(editor, source) : undefined),
      setTextSelection: (from, to) =>
        editor
          ? editor
              .chain()
              .setTextSelection({
                from: Math.max(1, Math.min(from, editor.state.doc.content.size)),
                to: Math.max(1, Math.min(to, editor.state.doc.content.size)),
              })
              .run()
          : false,
      focus: () => {
        editor?.commands.focus();
      },
      navigate: (command) => {
        if (!editor) return false;
        if (command === 'selection') return editor.chain().focus().scrollIntoView().run();
        let position = command === 'top' ? 1 : command === 'bottom' ? editor.state.doc.content.size : -1;
        if (position < 0) {
          const current = editor.state.selection.head;
          const nodeType = command.endsWith('heading') ? 'heading' : 'paragraph';
          const candidates: number[] = [];
          editor.state.doc.descendants((node, nodePosition) => {
            if (node.type.name === nodeType) candidates.push(nodePosition + 1);
          });
          position = command.startsWith('previous')
            ? ([...candidates].reverse().find((candidate) => candidate < current) ?? -1)
            : (candidates.find((candidate) => candidate > current) ?? -1);
        }
        if (position < 0) return false;
        return editor.chain().focus().setTextSelection(position).scrollIntoView().run();
      },
    };
    onHandle?.(handle);
    return () => onHandle?.(null);
  }, [editor, executeEditorCommand, onCommand, onHandle]);
  useEffect(() => {
    onTableActiveChange?.(tableActive);
  }, [onTableActiveChange, tableActive]);
  useEffect(() => () => onTableActiveChange?.(false), [onTableActiveChange]);
  useEffect(() => {
    if (!editor) return;
    if (source === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }
    editor.commands.setContent(markdownToStructuredHtml(source), { emitUpdate: false });
  }, [editor, source]);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('spellcheck', spellcheckEnabled ? 'true' : 'false');
    if (language) editor.view.dom.setAttribute('lang', language);
    else editor.view.dom.removeAttribute('lang');
  }, [editor, language, spellcheckEnabled]);
  useEffect(() => {
    if (!editor) return;
    const segments = structuredTextSegments(editor, source);
    const ranges: StructuredSearchRange[] = (searchHighlights?.matches || [])
      .slice(0, 5_000)
      .flatMap((match, index) => {
        const range = structuredRangeForMarkdown(segments, match);
        return range ? [{ ...range, active: index === searchHighlights?.activeIndex }] : [];
      });
    editor.view.dispatch(editor.state.tr.setMeta(structuredSearchKey, ranges));
    const active = ranges.find((range) => range.active);
    if (active) editor.chain().setTextSelection({ from: active.from, to: active.to }).scrollIntoView().run();
  }, [editor, searchHighlights, source]);
  useEffect(() => {
    if (!editor) return;
    const saved = viewStateRef.current;
    const maximum = editor.state.doc.content.size;
    editor.commands.setTextSelection({
      from: Math.max(1, Math.min(saved.anchor || 1, maximum)),
      to: Math.max(1, Math.min(saved.head || saved.anchor || 1, maximum)),
    });
    const container = editor.view.dom.closest('.structured-editor');
    if (!(container instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      container.scrollTop = saved.scrollTop;
      container.scrollLeft = saved.scrollLeft;
    });
    const onScroll = () =>
      onViewStateChangeRef.current({
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      });
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [documentId, editor]);
  if (!editor)
    return (
      <div className="structured-loading" role="status">
        Loading structured editor…
      </div>
    );
  const editorRegionId = `structured-editor-${documentId}`;
  const invokeCommand = (id: StructuredEditorCommandId) => () => {
    if (onCommand) onCommand(id);
    else void executeEditorCommand(id);
    setTableActive(editor.isActive('table'));
  };
  const imageFiles = (files: FileList) =>
    Array.from(files).filter(
      (file) =>
        file.type.startsWith('image/') || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name),
    );
  const insertFiles = async (files: File[]) => {
    if (!onImageFiles) return;
    try {
      const images = await onImageFiles(files);
      for (const image of images)
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'image',
            attrs: {
              src: image.src,
              alt: image.alt,
              title: image.title,
              width: image.width,
              height: image.height,
              alignment: image.alignment,
            },
          })
          .run();
    } catch (cause) {
      window.alert(`Image paste/drop failed: ${cause instanceof Error ? cause.message : 'Unknown error'}`);
    }
  };
  const pasteImages = (event: ClipboardEvent<HTMLElement>) => {
    const files = imageFiles(event.clipboardData.files);
    if (!files.length || !onImageFiles) return;
    event.preventDefault();
    void insertFiles(files);
  };
  const dropImages = (event: DragEvent<HTMLElement>) => {
    const files = imageFiles(event.dataTransfer.files);
    if (!files.length || !onImageFiles) return;
    event.preventDefault();
    void insertFiles(files);
  };
  return (
    <section
      className="structured-editor"
      aria-label="Structured editor workspace"
      onPasteCapture={pasteImages}
      onDragOver={(event) => {
        if (imageFiles(event.dataTransfer.files).length) event.preventDefault();
      }}
      onDropCapture={dropImages}
    >
      {floatingMenu.visible && (
        <div
          className="floating-toolbar"
          style={{
            position: 'fixed',
            top: `${floatingMenu.y}px`,
            left: `${floatingMenu.x}px`,
            transform: 'translate(-50%, -100%)',
          }}
          role="toolbar"
          aria-label="Structured editor formatting"
          onKeyDown={navigateToolbar}
        >
          <button
            type="button"
            className={editor.isActive('bold') ? 'active' : ''}
            title="Bold"
            onClick={invokeCommand('editor.toggleBold')}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            className={editor.isActive('italic') ? 'active' : ''}
            title="Italic"
            onClick={invokeCommand('editor.toggleItalic')}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            className={editor.isActive('strike') ? 'active' : ''}
            title="Strikethrough"
            onClick={invokeCommand('editor.toggleStrike')}
          >
            <Strikethrough size={14} />
          </button>
          <button
            type="button"
            className={editor.isActive('code') ? 'active' : ''}
            title="Code"
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code size={14} />
          </button>
          <button
            type="button"
            className={editor.isActive('link') ? 'active' : ''}
            title="Link"
            onClick={invokeCommand('editor.editLink')}
          >
            <LinkIcon size={14} />
          </button>
          <button
            type="button"
            className={editor.isActive('highlight') ? 'active' : ''}
            title="Highlight"
            onClick={invokeCommand('editor.toggleHighlight')}
          >
            <Highlighter size={14} />
          </button>
          <span className="divider" />
          <button
            type="button"
            title="Clear formatting"
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
          >
            <Eraser size={14} />
          </button>
        </div>
      )}
      {tableActive && (
        <div className="table-context-toolbar" role="toolbar" aria-label="Table tools">
          <button aria-label="Row above" onClick={invokeCommand('table.addRowBefore')}>
            Row Up
          </button>
          <button aria-label="Row below" onClick={invokeCommand('table.addRowAfter')}>
            Row Down
          </button>
          <button aria-label="Column before" onClick={invokeCommand('table.addColumnBefore')}>
            Col Left
          </button>
          <button aria-label="Column after" onClick={invokeCommand('table.addColumnAfter')}>
            Col Right
          </button>
          <span className="divider" />
          <button aria-label="Delete row" onClick={invokeCommand('table.deleteRow')}>
            Del Row
          </button>
          <button aria-label="Delete column" onClick={invokeCommand('table.deleteColumn')}>
            Del Col
          </button>
          <span className="divider" />
          <button aria-label="Copy Markdown" onClick={invokeCommand('table.copyMarkdown')}>
            Copy MD
          </button>
          <button aria-label="Copy TSV" onClick={invokeCommand('table.copyTsv')}>
            Copy TSV
          </button>
          <span className="divider" />
          <button aria-label="Delete table" onClick={invokeCommand('table.delete')} className="delete-btn">
            Del Table
          </button>
        </div>
      )}
      {slashMenu.visible && filteredCommands.length > 0 && (
        <div
          className="slash-commands-menu"
          style={{
            position: 'fixed',
            top: `${slashMenu.y}px`,
            left: `${slashMenu.x}px`,
            transform: 'translateY(4px)',
          }}
          role="listbox"
          aria-label="Slash commands"
        >
          {filteredCommands.map((cmd, index) => (
            <div
              key={cmd.label}
              className={`slash-command-item ${index === slashMenu.selectedIndex ? 'active' : ''}`}
              role="option"
              aria-selected={index === slashMenu.selectedIndex}
              onClick={() => handleSelectCommand(cmd, editor)}
            >
              <div className="slash-command-label">{cmd.label}</div>
              <div className="slash-command-desc">{cmd.description}</div>
            </div>
          ))}
        </div>
      )}
      <div id={editorRegionId}>
        <EditorContent editor={editor} />
      </div>
      <TextInputDialog
        open={inputDialog !== null}
        title={inputDialog?.kind === 'link' ? 'Edit link' : 'Insert image from URL'}
        description={
          inputDialog?.kind === 'link'
            ? 'Enter a URL, relative path, email address, or heading anchor.'
            : 'Enter the web address of an image. Markora does not download it until you choose to save it locally.'
        }
        label={inputDialog?.kind === 'link' ? 'Link destination' : 'Image URL'}
        initialValue={inputDialog?.initialValue}
        placeholder={
          inputDialog?.kind === 'link' ? 'https:// or ./document.md' : 'https://example.com/image.png'
        }
        submitLabel={inputDialog?.kind === 'link' ? 'Apply link' : 'Insert image'}
        allowEmpty={inputDialog?.kind === 'link'}
        validate={inputDialog?.kind === 'link' ? validateLinkDestination : undefined}
        onRemove={
          inputDialog?.kind === 'link' && inputDialog.canRemove
            ? () => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setInputDialog(null);
              }
            : undefined
        }
        onSubmit={(value) => {
          if (inputDialog?.kind === 'link') {
            if (!value) editor.chain().focus().extendMarkRange('link').unsetLink().run();
            else editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
          } else if (inputDialog?.kind === 'image' && value) {
            editor.chain().focus().setImage({ src: value, alt: 'Image' }).run();
          }
          setInputDialog(null);
        }}
        onClose={() => setInputDialog(null)}
      />
    </section>
  );
}
