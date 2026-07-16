import type { HtmlExportFileResult, HtmlExportRequest, HtmlExportResult } from './html-export';
import type { ApplicationCommandId } from './application-commands';

export type {
  HtmlExportFileResult,
  HtmlExportMetadata,
  HtmlExportOptions,
  HtmlExportRequest,
  HtmlExportResult,
  HtmlExportTheme,
  HtmlExportWarning,
  HtmlExportWarningCode,
} from './html-export';

export type DocumentMode = 'source' | 'reading';

export interface DiskFingerprintRecord {
  modifiedAt: number;
  size: number;
  sha256: string;
}

export interface FileRecord {
  path: string;
  name: string;
  content: string;
  lineEnding: 'LF' | 'CRLF';
  modifiedAt: number;
  /** Present for files opened by the conflict-aware file service. */
  fingerprint?: DiskFingerprintRecord;
}

export interface SaveFileRequest {
  path?: string;
  content: string;
  expectedFingerprint?: DiskFingerprintRecord;
  /** Overwrite is accepted only when overwriteConfirmed is also true. */
  overwrite?: boolean;
  overwriteConfirmed?: boolean;
  createBackup?: boolean;
  documentId?: string;
  documentName?: string;
  lineEnding?: 'LF' | 'CRLF';
}

export type SaveFailureCode =
  'READ_ONLY' | 'PERMISSION_DENIED' | 'DISK_FULL' | 'PATH_TOO_LONG' | 'INVALID_DESTINATION' | 'WRITE_FAILED';

export interface SaveFileSuccess {
  status: 'saved';
  file: FileRecord;
  backupPath?: string;
}

export interface SaveFileConflict {
  status: 'conflict';
  conflict: {
    kind: 'modified' | 'deleted' | 'renamed' | 'destination-exists';
    path: string;
    renamedPath?: string;
    expected: DiskFingerprintRecord | null;
    actual: DiskFingerprintRecord | null;
    disk?: FileRecord;
  };
}

export interface SaveFileFailure {
  status: 'failed';
  failure: {
    code: SaveFailureCode;
    path: string;
    message: string;
    systemCode?: string;
    recoverySnapshotId?: string;
  };
}

export type SaveFileResult = SaveFileSuccess | SaveFileConflict | SaveFileFailure;

export interface ExternalFileChangeEvent {
  kind: 'modified' | 'renamed' | 'deleted';
  path: string;
  renamedPath?: string;
  previousFingerprint: DiskFingerprintRecord;
  fingerprint: DiskFingerprintRecord | null;
  record?: FileRecord;
  observedAt: number;
}

export interface RecoverySnapshotRecord {
  version: 1;
  snapshotId: string;
  id: string;
  path?: string;
  name?: string;
  content: string;
  lineEnding?: 'LF' | 'CRLF';
  reason?: 'autosave' | 'shutdown' | 'conflict' | 'write-failure';
  createdAt: number;
  updatedAt: number;
}

export interface RecoverySessionDocument {
  id: string;
  path?: string;
  name: string;
  mode: 'source' | 'structured';
  active: boolean;
}

export interface RecoverySessionRecord {
  version: 1;
  savedAt: number;
  workspacePath?: string;
  documents: RecoverySessionDocument[];
}

export interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeEntry[];
  modifiedAt?: number;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  wordWrap: boolean;
  autosaveSeconds: number;
  safeExternalLinks: boolean;
}

export interface CustomThemeTokenSet {
  background: string;
  panel: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  accent: string;
  accentContrast: string;
  codeBackground: string;
  selection: string;
  link: string;
  blockquote: string;
  tableStripe: string;
}

/** Versioned, portable custom theme package. CSS is always document-scoped by the host. */
export interface CustomThemePackage {
  version: 1;
  id?: string;
  name: string;
  description: string;
  author?: string;
  light: CustomThemeTokenSet;
  dark: CustomThemeTokenSet;
  css?: string;
}

export interface CustomThemeRecord extends CustomThemePackage {
  id: string;
  updatedAt: number;
}

export const defaultSettings: AppSettings = {
  theme: 'system',
  fontSize: 16,
  lineHeight: 1.65,
  contentWidth: 860,
  wordWrap: true,
  autosaveSeconds: 15,
  safeExternalLinks: true,
};

export type ImageAssetStrategy =
  'keep-original' | 'document-sibling' | 'assets' | 'document-assets' | 'workspace-assets' | 'date-based';

export type ImageAssetPathPreference = 'auto' | 'document-relative' | 'workspace-relative' | 'absolute';

export interface ImageAssetContext {
  documentPath?: string;
  workspaceRoot?: string;
  workspaceAssetDirectoryName?: string;
}

export type ImageAssetSource =
  | { kind: 'local'; path: string }
  | { kind: 'clipboard'; data: Uint8Array; mimeType: string }
  | { kind: 'remote'; url: string };

export interface ImageAssetImportRequest {
  operationId: string;
  source: ImageAssetSource;
  strategy: ImageAssetStrategy;
  filename: string;
  context: ImageAssetContext;
  conflictPolicy?: 'rename' | 'error' | 'overwrite';
  markdownPathPreference?: ImageAssetPathPreference;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ImageAssetResult {
  directoryPath: string;
  assetPath: string;
  filename: string;
  requestedFilename: string;
  renamedForConflict: boolean;
  sourceKind: 'local' | 'clipboard' | 'remote';
  originalSource: string | null;
  copied: boolean;
  byteLength: number;
  mimeType?: string;
  markdownPath: string;
  markdownPathKind: 'document-relative' | 'workspace-relative' | 'absolute';
}

export interface ImageFileSelection {
  path: string;
  displayName: string;
}

export type PandocExportFormat = 'docx' | 'odt' | 'rtf' | 'epub' | 'latex' | 'mediawiki' | 'plain';
export type PandocImportFormat = 'docx' | 'odt' | 'rtf' | 'html' | 'latex';

export interface PandocStatusRecord {
  available: boolean;
  status: 'available' | 'missing' | 'invalid-manual';
  executablePath?: string;
  version?: string;
  source?: 'manual' | 'path' | 'common';
  message: string;
  attempts: Array<{ path: string; message: string; code: string }>;
}

export interface PandocProgressRecord {
  operationId: string;
  stage: 'validating' | 'probing' | 'converting' | 'completed';
  message: string;
  stdoutBytes: number;
  stderrBytes: number;
}

export interface PandocConversionRecord {
  operationId: string;
  outputPath?: string;
  markdown?: string;
  version: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SpellcheckSettings {
  enabled: boolean;
  languages: string[];
  userDictionary: string[];
}

export interface SpellcheckStatus extends SpellcheckSettings {
  availableLanguages: string[];
}

export interface WorkspaceSearchOptions {
  workspaceRoot: string;
  query: string;
  scope?: 'filename' | 'content' | 'both';
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  respectGitignore?: boolean;
  ignoredDirectories?: string[];
}

export interface WorkspaceSearchMatchRecord {
  id: string;
  fingerprint: string;
  kind: 'filename' | 'content';
  line: number;
  column: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
  matchedText: string;
  preview: string;
  previewStartColumn: number;
  previewMatchStart: number;
  previewMatchLength: number;
}

export interface WorkspaceFileSearchRecord {
  id: string;
  path: string;
  relativePath: string;
  filename: string;
  fingerprint: string;
  matches: WorkspaceSearchMatchRecord[];
}

export interface WorkspaceSearchResultRecord {
  workspaceRoot: string;
  files: WorkspaceFileSearchRecord[];
  matchCount: number;
  matchedFileCount: number;
  searchedFileCount: number;
  discoveredFileCount: number;
  truncated: boolean;
  durationMs: number;
  failures: Array<{ path: string; relativePath?: string; code: string; message: string }>;
}

export interface WorkspaceReplacePreviewRecord {
  previewToken: string;
  confirmationToken: string;
  expiresAt: number;
  workspaceRoot: string;
  files: Array<
    Omit<WorkspaceFileSearchRecord, 'matches'> & {
      matches: Array<WorkspaceSearchMatchRecord & { replacementText: string; selected: boolean }>;
      selectedMatchCount: number;
    }
  >;
  selectedFileCount: number;
  selectedMatchCount: number;
  totalContentMatchCount: number;
  failures: WorkspaceSearchResultRecord['failures'];
}

export interface WorkspaceReplaceResultRecord {
  previewToken: string;
  files: Array<{
    fileId: string;
    path: string;
    relativePath: string;
    status: 'replaced' | 'failed' | 'cancelled';
    replacementCount: number;
    backupPath?: string;
    code?: string;
    message?: string;
  }>;
  replacedFileCount: number;
  replacedMatchCount: number;
  failedFileCount: number;
  cancelled: boolean;
  backupRoot: string;
}

export interface WorkspaceSearchProgressRecord {
  operationId: string;
  phase: 'enumerating' | 'searching' | 'complete';
  discoveredFiles: number;
  searchedFiles: number;
  matchCount: number;
}

export type PdfPageSize =
  'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'Legal' | 'Letter' | 'Tabloid' | 'Ledger' | 'Custom';

export interface PdfPageMargins {
  /** Print margin in millimetres. */
  top: number;
  /** Print margin in millimetres. */
  right: number;
  /** Print margin in millimetres. */
  bottom: number;
  /** Print margin in millimetres. */
  left: number;
}

export interface PdfHeaderFooterOptions {
  enabled: boolean;
  /** User-authored plain text. Markora escapes it before creating Chromium templates. */
  text: string;
}

export interface PdfPageBreakOptions {
  beforeHeadings: Array<1 | 2 | 3 | 4 | 5 | 6>;
  avoidInsideTables: boolean;
  avoidInsideCodeBlocks: boolean;
  avoidInsideBlockquotes: boolean;
  keepHeadingWithNext: boolean;
}

export interface PdfExportOptions {
  pageSize: PdfPageSize;
  /** Used only for Custom. Dimensions are expressed in millimetres. */
  customPageSize?: { widthMm: number; heightMm: number };
  orientation: 'portrait' | 'landscape';
  margins: PdfPageMargins;
  /** Chromium print scale, from 0.25 through 2. */
  scale: number;
  printBackground: boolean;
  header: PdfHeaderFooterOptions;
  footer: PdfHeaderFooterOptions;
  pageNumbers: boolean;
  title: string;
  author: string;
  date: string;
  tableOfContents: boolean;
  printTheme: 'document' | 'light' | 'dark' | 'sepia';
  lightThemeOverride: boolean;
  printCss: string;
  pageBreaks: PdfPageBreakOptions;
  allowRemoteImages: boolean;
  generateTaggedPdf: boolean;
  generateDocumentOutline: boolean;
}

export interface PdfHeadingRecord {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;
}

export interface PdfExportDocument {
  /** Sanitized, already-rendered document body (KaTeX/Mermaid should be rendered here). */
  html: string;
  headings: PdfHeadingRecord[];
  sourcePath?: string;
}

export interface PdfExportRequest {
  operationId: string;
  outputPath: string;
  document: PdfExportDocument;
  options: PdfExportOptions;
}

export interface PdfPreviewRequest {
  document: PdfExportDocument;
  options: PdfExportOptions;
}

export interface PdfPreviewRecord {
  html: string;
  pageWidthMm: number;
  pageHeightMm: number;
}

export interface PdfExportResult {
  operationId: string;
  outputPath: string;
  byteLength: number;
  pageCount: number | null;
  durationMs: number;
  generatedTaggedPdf: boolean;
  generatedDocumentOutline: boolean;
}

export interface PdfExportProgressRecord {
  operationId: string;
  stage: 'preparing' | 'rendering' | 'writing' | 'completed';
  message: string;
}

export interface MarkoraApi {
  openFile(): Promise<FileRecord | null>;
  openPath(path: string): Promise<FileRecord>;
  /** Receives validated Markdown operands from first-launch and single-instance forwarding. */
  onOpenFiles(callback: (paths: string[]) => void): () => void;
  /** Receives allowlisted native-menu actions for execution by the renderer command registry. */
  onCommand(callback: (id: ApplicationCommandId) => void): () => void;
  /** Compatibility save API; conflict-aware callers should use saveFileChecked. */
  saveFile(request: SaveFileRequest): Promise<FileRecord | null>;
  saveFileChecked(request: SaveFileRequest): Promise<SaveFileResult | null>;
  acceptDiskVersion(request: { path: string; fingerprint: DiskFingerprintRecord }): Promise<void>;
  unwatchFile(path: string): Promise<void>;
  checkExternalFile(path: string): Promise<ExternalFileChangeEvent | null>;
  openWorkspace(): Promise<{ path: string; tree: TreeEntry[] } | null>;
  readTree(path: string): Promise<TreeEntry[]>;
  previewHtmlExport(request: HtmlExportRequest): Promise<HtmlExportResult>;
  exportHtml(request: HtmlExportRequest): Promise<HtmlExportFileResult | null>;
  pickPdfOutput(title: string): Promise<ImageFileSelection | null>;
  previewPdf(request: PdfPreviewRequest): Promise<PdfPreviewRecord>;
  exportPdf(request: PdfExportRequest): Promise<PdfExportResult>;
  cancelPdf(operationId: string): Promise<boolean>;
  onPdfExportProgress(callback: (progress: PdfExportProgressRecord) => void): () => void;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  listCustomThemes(): Promise<CustomThemeRecord[]>;
  importCustomTheme(): Promise<CustomThemeRecord | null>;
  saveCustomTheme(theme: CustomThemePackage): Promise<CustomThemeRecord>;
  duplicateCustomTheme(id: string): Promise<CustomThemeRecord>;
  deleteCustomTheme(id: string): Promise<void>;
  exportCustomTheme(id: string): Promise<boolean>;
  saveRecovery(entry: {
    id: string;
    path?: string;
    name?: string;
    content: string;
    lineEnding?: 'LF' | 'CRLF';
    reason?: 'autosave' | 'shutdown' | 'conflict' | 'write-failure';
  }): Promise<RecoverySnapshotRecord>;
  getRecoveries(): Promise<RecoverySnapshotRecord[]>;
  getRecoveryHistory(id: string): Promise<RecoverySnapshotRecord[]>;
  clearRecovery(id: string): Promise<void>;
  saveRecoverySession(session: {
    workspacePath?: string;
    documents: RecoverySessionDocument[];
  }): Promise<void>;
  loadRecoverySession(): Promise<RecoverySessionRecord | null>;
  revealPath(path: string): Promise<void>;
  openPathExternal(path: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  pickImageFile(): Promise<ImageFileSelection | null>;
  importImageAsset(request: ImageAssetImportRequest): Promise<ImageAssetResult>;
  cancelImageOperation(operationId: string): Promise<boolean>;
  resolveImageReference(request: {
    reference: string;
    documentPath?: string;
    workspaceRoot?: string;
  }): Promise<string>;
  copyImageToClipboard(path: string): Promise<boolean>;
  detectPandoc(manualExecutable?: string): Promise<PandocStatusRecord>;
  pickPandocExecutable(): Promise<PandocStatusRecord | null>;
  pickPandocInput(format: PandocImportFormat): Promise<ImageFileSelection | null>;
  pickPandocOutput(request: {
    format: PandocExportFormat;
    title: string;
  }): Promise<ImageFileSelection | null>;
  previewPandocImport(request: {
    operationId: string;
    executablePath: string;
    format: PandocImportFormat;
    inputPath: string;
  }): Promise<PandocConversionRecord>;
  exportWithPandoc(request: {
    operationId: string;
    executablePath: string;
    format: PandocExportFormat;
    outputPath: string;
    markdown: string;
    metadata?: { title?: string; author?: string; date?: string };
  }): Promise<PandocConversionRecord>;
  cancelPandoc(operationId: string): Promise<boolean>;
  onPandocProgress(callback: (progress: PandocProgressRecord) => void): () => void;
  getSpellcheckStatus(): Promise<SpellcheckStatus>;
  configureSpellcheck(settings: SpellcheckSettings): Promise<SpellcheckStatus>;
  applyDocumentSpellcheck(request: { enabled: boolean; language?: string }): Promise<void>;
  addToDictionary(word: string): Promise<boolean>;
  ignoreSpelling(word: string): Promise<boolean>;
  searchWorkspaceAdvanced(request: {
    operationId: string;
    search: WorkspaceSearchOptions;
  }): Promise<WorkspaceSearchResultRecord>;
  previewWorkspaceReplace(request: {
    operationId: string;
    search: WorkspaceSearchOptions;
    replacement: string;
    selection?: { includeFileIds?: string[]; includeMatchIds?: string[]; excludeMatchIds?: string[] };
  }): Promise<WorkspaceReplacePreviewRecord>;
  applyWorkspaceReplace(request: {
    operationId: string;
    previewToken: string;
    confirmationToken: string;
    confirmed: boolean;
    createBackups: boolean;
  }): Promise<WorkspaceReplaceResultRecord>;
  discardWorkspaceReplace(request: { operationId: string; previewToken: string }): Promise<boolean>;
  cancelWorkspaceOperation(operationId: string): Promise<void>;
  onWorkspaceSearchProgress(callback: (progress: WorkspaceSearchProgressRecord) => void): () => void;
  onExternalFileChange(callback: (event: ExternalFileChangeEvent) => void): () => void;
  /** Compatibility event emitted for external modifications only. */
  onExternalChange(callback: (record: FileRecord) => void): () => void;
  isE2e?: boolean;
}
