export type HtmlExportTheme = 'markora-light' | 'markora-dark' | 'github-light' | 'github-dark' | 'print';

export interface HtmlExportMetadata {
  title?: string;
  author?: string;
  description?: string;
  date?: string;
  language?: string;
}

/**
 * Options which affect the generated document. Paths are deliberately not part
 * of this object: the main process supplies path context after a user-approved
 * file or folder selection.
 */
export interface HtmlExportOptions {
  standalone: boolean;
  styling: 'styled' | 'unstyled';
  embedCss: boolean;
  embedLocalImages: boolean;
  includeTableOfContents: boolean;
  syntaxHighlighting: boolean;
  renderMath: boolean;
  renderMermaid: boolean;
  theme: HtmlExportTheme;
  metadata?: HtmlExportMetadata;
}

export interface HtmlExportRequest {
  markdown: string;
  sourcePath?: string;
  workspaceRoot?: string;
  options: HtmlExportOptions;
}

export type HtmlExportWarningCode =
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_OUTSIDE_ALLOWED_ROOTS'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_UNSUPPORTED_TYPE'
  | 'IMAGE_READ_FAILED'
  | 'IMAGE_CONTEXT_REQUIRED'
  | 'IMAGE_URL_REJECTED'
  | 'CSS_NOT_EMBEDDED'
  | 'MERMAID_RUNTIME_UNAVAILABLE';

export interface HtmlExportWarning {
  code: HtmlExportWarningCode;
  message: string;
  source?: string;
}

export interface HtmlExportResult {
  html: string;
  warnings: HtmlExportWarning[];
  embeddedImageCount: number;
  headingCount: number;
  hasMath: boolean;
  hasMermaid: boolean;
}

export interface HtmlExportFileResult extends Omit<HtmlExportResult, 'html'> {
  path: string;
  byteLength: number;
}

export const defaultHtmlExportOptions: HtmlExportOptions = {
  standalone: true,
  styling: 'styled',
  embedCss: true,
  embedLocalImages: false,
  includeTableOfContents: false,
  syntaxHighlighting: true,
  renderMath: true,
  renderMermaid: true,
  theme: 'markora-light',
};
