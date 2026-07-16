export type ImageAlignment = 'default' | 'left' | 'center' | 'right';
export type ImageSyntaxKind = 'markdown' | 'html';
export type ImageOutputFormat = ImageSyntaxKind | 'auto';
export type ImageSourceKind = 'file' | 'url';

export type AssetDestinationStrategy =
  | 'keep-original'
  | 'document-directory'
  | 'assets-directory'
  | 'document-assets-directory'
  | 'workspace-assets-directory'
  | 'date-directory';

export interface ImageOptions {
  readonly src: string;
  readonly alt: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly preserveAspectRatio: boolean;
  readonly alignment: ImageAlignment;
}

export interface ImageRange {
  readonly start: number;
  readonly end: number;
}

export interface ParsedImage extends ImageOptions {
  readonly syntax: ImageSyntaxKind;
  readonly range: ImageRange;
  readonly raw: string;
}

export interface ImageValidationIssue {
  readonly field: keyof ImageOptions | 'sourceKind' | 'destination';
  readonly code: string;
  readonly message: string;
}

export interface ImageWorkflowValue extends ImageOptions {
  readonly sourceKind: ImageSourceKind;
  readonly destination: AssetDestinationStrategy;
}

export interface ImageValidationContext {
  readonly documentSaved?: boolean;
  readonly workspaceAvailable?: boolean;
}

export const ASSET_DESTINATION_OPTIONS: ReadonlyArray<{
  value: AssetDestinationStrategy;
  label: string;
  description: string;
  requiresSavedDocument?: boolean;
  requiresWorkspace?: boolean;
}> = [
  {
    value: 'keep-original',
    label: 'Keep original path or URL',
    description: 'Reference the selected source without copying it.',
  },
  {
    value: 'document-directory',
    label: 'Next to the document',
    description: 'Copy the image into the Markdown document directory.',
    requiresSavedDocument: true,
  },
  {
    value: 'assets-directory',
    label: 'assets directory',
    description: 'Copy the image into an assets directory next to the document.',
    requiresSavedDocument: true,
  },
  {
    value: 'document-assets-directory',
    label: '{document-name}.assets',
    description: 'Use an asset directory named after the Markdown document.',
    requiresSavedDocument: true,
  },
  {
    value: 'workspace-assets-directory',
    label: 'Workspace asset directory',
    description: 'Copy into the configured workspace-level asset directory.',
    requiresWorkspace: true,
  },
  {
    value: 'date-directory',
    label: 'Date-based directory',
    description: 'Copy into an assets/YYYY/MM/DD directory next to the document.',
    requiresSavedDocument: true,
  },
];

const markdownImagePattern =
  /!\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\n]*>|(?:\\.|[^()\s]|\([^()\n]*\))+)(?:\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|\(((?:\\.|[^)\\])*)\)))?\s*\)/g;

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/gs, '$1');
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\r?\n/g, ' ');
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function markdownDestination(value: string): string {
  const destination = value.replace(/[\r\n]/g, '');
  if (/\s|[<>]/.test(destination)) {
    return `<${destination.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
  }
  return destination.replace(/\\/g, '\\\\').replace(/([()])/g, '\\$1');
}

function parseDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim());
  if (!match) return undefined;
  const dimension = Number(match[1]);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : undefined;
}

function parseHtmlAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<img\b/i, '').replace(/\/?\s*>$/, '');
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    attributes.set(match[1].toLocaleLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function alignmentFromAttributes(attributes: Map<string, string>): ImageAlignment {
  const explicit = (attributes.get('data-markora-align') ?? attributes.get('align'))?.toLowerCase();
  if (explicit === 'left' || explicit === 'center' || explicit === 'right') return explicit;

  const style = (attributes.get('style') ?? '').toLowerCase().replace(/\s/g, '');
  if (/float:right(?:;|$)/.test(style) || /margin-left:auto(?:;|$)/.test(style)) {
    if (/margin-right:auto(?:;|$)/.test(style)) return 'center';
    return 'right';
  }
  if (/float:left(?:;|$)/.test(style) || /margin-right:auto(?:;|$)/.test(style)) return 'left';
  if (/margin:(?:0|[^;]*\s)?auto(?:;|$)/.test(style)) return 'center';
  return 'default';
}

function scanHtmlImageTags(source: string): ImageRange[] {
  const ranges: ImageRange[] = [];
  const opening = /<img\b/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(source)) !== null) {
    let quote: '"' | "'" | null = null;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        end += 1;
        break;
      }
    }
    if (end <= source.length && source[end - 1] === '>') {
      ranges.push({ start: match.index, end });
      opening.lastIndex = end;
    } else {
      break;
    }
  }
  return ranges;
}

function parseHtmlImage(raw: string, range: ImageRange): ParsedImage | null {
  const attributes = parseHtmlAttributes(raw);
  const src = attributes.get('src');
  if (!src) return null;
  const style = (attributes.get('style') ?? '').toLowerCase().replace(/\s/g, '');
  return {
    syntax: 'html',
    raw,
    range,
    src,
    alt: attributes.get('alt') ?? '',
    title: attributes.get('title') || undefined,
    width: parseDimension(attributes.get('width')),
    height: parseDimension(attributes.get('height')),
    preserveAspectRatio:
      attributes.get('data-markora-preserve-aspect') === 'true' ||
      /(?:width|height):auto(?:;|$)|object-fit:contain(?:;|$)/.test(style),
    alignment: alignmentFromAttributes(attributes),
  };
}

function parseMarkdownImage(match: RegExpExecArray): ParsedImage {
  const rawDestination = match[2];
  const destination = rawDestination.startsWith('<')
    ? rawDestination.slice(1, -1).replace(/%3C/gi, '<').replace(/%3E/gi, '>')
    : unescapeMarkdown(rawDestination);
  return {
    syntax: 'markdown',
    raw: match[0],
    range: { start: match.index, end: match.index + match[0].length },
    src: destination,
    alt: unescapeMarkdown(match[1]),
    title: unescapeMarkdown(match[3] ?? match[4] ?? match[5] ?? '') || undefined,
    preserveAspectRatio: true,
    alignment: 'default',
  };
}

/** Finds inline Markdown images and standalone HTML img tags in source order. */
export function findImageSyntax(source: string): ParsedImage[] {
  const images: ParsedImage[] = [];
  markdownImagePattern.lastIndex = 0;
  for (const match of source.matchAll(markdownImagePattern)) images.push(parseMarkdownImage(match));

  for (const range of scanHtmlImageTags(source)) {
    const parsed = parseHtmlImage(source.slice(range.start, range.end), range);
    if (parsed) images.push(parsed);
  }
  return images.sort((left, right) => left.range.start - right.range.start);
}

/** Parses a string containing exactly one image, allowing surrounding whitespace. */
export function parseImageSyntax(source: string): ParsedImage | null {
  const images = findImageSyntax(source);
  if (images.length !== 1) return null;
  const image = images[0];
  if (source.slice(0, image.range.start).trim() || source.slice(image.range.end).trim()) return null;
  return image;
}

function unsafeSourceReason(src: string): string | null {
  if (!src.trim()) return 'Choose an image source.';
  if (Array.from(src).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return 'Image source contains control characters.';
  }
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(src)?.[1]?.toLowerCase();
  const windowsDrive = /^[a-z]:[\\/]/i.test(src);
  if (scheme && !windowsDrive && !['http', 'https', 'file'].includes(scheme)) {
    return `The ${scheme}: scheme is not allowed for images.`;
  }
  return null;
}

export function validateRemoteImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? null
      : 'Remote images must use HTTPS or HTTP.';
  } catch {
    return 'Enter a complete HTTPS or HTTP image URL.';
  }
}

export function validateImageOptions(options: ImageOptions): ImageValidationIssue[] {
  const issues: ImageValidationIssue[] = [];
  const sourceReason = unsafeSourceReason(options.src);
  if (sourceReason) issues.push({ field: 'src', code: 'invalid-source', message: sourceReason });
  if (options.alt.length > 2_000) {
    issues.push({
      field: 'alt',
      code: 'alt-too-long',
      message: 'Alt text must be 2,000 characters or fewer.',
    });
  }
  if ((options.title?.length ?? 0) > 2_000) {
    issues.push({
      field: 'title',
      code: 'title-too-long',
      message: 'Title must be 2,000 characters or fewer.',
    });
  }
  for (const field of ['width', 'height'] as const) {
    const value = options[field];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 100_000)) {
      issues.push({
        field,
        code: 'invalid-dimension',
        message: `${field === 'width' ? 'Width' : 'Height'} must be between 1 and 100,000 pixels.`,
      });
    }
  }
  if (!['default', 'left', 'center', 'right'].includes(options.alignment)) {
    issues.push({ field: 'alignment', code: 'invalid-alignment', message: 'Choose a valid alignment.' });
  }
  return issues;
}

export function validateImageWorkflow(
  value: ImageWorkflowValue,
  context: ImageValidationContext = {},
): ImageValidationIssue[] {
  const issues = validateImageOptions(value);
  if (value.sourceKind === 'url') {
    const urlError = validateRemoteImageUrl(value.src);
    if (urlError) issues.push({ field: 'src', code: 'invalid-remote-url', message: urlError });
  } else if (value.sourceKind !== 'file') {
    issues.push({ field: 'sourceKind', code: 'invalid-source-kind', message: 'Choose a file or URL.' });
  }

  const destination = ASSET_DESTINATION_OPTIONS.find((item) => item.value === value.destination);
  if (!destination) {
    issues.push({
      field: 'destination',
      code: 'invalid-destination',
      message: 'Choose an asset destination.',
    });
  } else if (destination.requiresSavedDocument && context.documentSaved === false) {
    issues.push({
      field: 'destination',
      code: 'document-must-be-saved',
      message: 'Save the Markdown document before using this asset destination.',
    });
  } else if (destination.requiresWorkspace && context.workspaceAvailable === false) {
    issues.push({
      field: 'destination',
      code: 'workspace-required',
      message: 'Open a workspace before using the workspace asset directory.',
    });
  }
  return issues;
}

function serializeMarkdownImage(options: ImageOptions): string {
  const title = options.title ? ` "${escapeMarkdownTitle(options.title)}"` : '';
  return `![${escapeMarkdownAlt(options.alt)}](${markdownDestination(options.src)}${title})`;
}

function serializeHtmlImage(options: ImageOptions): string {
  const attributes = [
    `src="${escapeHtmlAttribute(options.src)}"`,
    `alt="${escapeHtmlAttribute(options.alt)}"`,
  ];
  if (options.title) attributes.push(`title="${escapeHtmlAttribute(options.title)}"`);
  if (options.width !== undefined) attributes.push(`width="${options.width}"`);
  if (options.height !== undefined) attributes.push(`height="${options.height}"`);
  if (options.alignment !== 'default') {
    attributes.push(`data-markora-align="${options.alignment}"`);
  }
  if (options.preserveAspectRatio) attributes.push('data-markora-preserve-aspect="true"');

  const style = ['max-width: 100%'];
  if (options.preserveAspectRatio && options.width !== undefined && options.height === undefined) {
    style.push('height: auto');
  } else if (options.preserveAspectRatio && options.height !== undefined && options.width === undefined) {
    style.push('width: auto');
  } else if (options.preserveAspectRatio && options.width !== undefined && options.height !== undefined) {
    style.push('object-fit: contain');
  }
  if (options.alignment === 'left') style.push('display: block', 'margin-left: 0', 'margin-right: auto');
  if (options.alignment === 'center') style.push('display: block', 'margin-left: auto', 'margin-right: auto');
  if (options.alignment === 'right') style.push('display: block', 'margin-left: auto', 'margin-right: 0');
  attributes.push(`style="${style.join('; ')}"`);
  return `<img ${attributes.join(' ')}>`;
}

/** Serializes only validated, non-executable image markup. */
export function serializeImage(options: ImageOptions, format: ImageOutputFormat = 'auto'): string {
  const issues = validateImageOptions(options);
  if (issues.length > 0) throw new TypeError(issues.map((issue) => issue.message).join(' '));

  const needsHtml =
    options.width !== undefined || options.height !== undefined || options.alignment !== 'default';
  return format === 'html' || needsHtml ? serializeHtmlImage(options) : serializeMarkdownImage(options);
}

function validateRange(source: string, range: ImageRange): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > source.length
  ) {
    throw new RangeError('Image range must be within the source text.');
  }
}

export function replaceImageSyntax(
  source: string,
  target: ImageRange | Pick<ParsedImage, 'range'>,
  replacement: ImageOptions,
  format: ImageOutputFormat = 'auto',
): string {
  const range = 'range' in target ? target.range : target;
  validateRange(source, range);
  return `${source.slice(0, range.start)}${serializeImage(replacement, format)}${source.slice(range.end)}`;
}

export function insertImageSyntax(
  source: string,
  offset: number,
  image: ImageOptions,
  format: ImageOutputFormat = 'auto',
): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) {
    throw new RangeError('Image insertion offset must be within the source text.');
  }
  return `${source.slice(0, offset)}${serializeImage(image, format)}${source.slice(offset)}`;
}
