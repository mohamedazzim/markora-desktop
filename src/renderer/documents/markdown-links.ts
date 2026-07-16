/**
 * Safe, platform-neutral resolution for links authored in Markdown.
 *
 * The renderer must never hand an arbitrary URL to the filesystem bridge. This
 * module only classifies and resolves a link; the main process still enforces
 * workspace/file authority before reading the result.
 */

export type MarkdownLinkResolution =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'anchor'; readonly fragment: string }
  | { readonly kind: 'document'; readonly path: string; readonly fragment?: string }
  | { readonly kind: 'invalid'; readonly reason: string };

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape should not make link activation throw. Keeping the
    // original value lets the main process return a useful file-not-found or
    // unsupported-file message instead.
    return value;
  }
}

function splitFragment(value: string): { readonly path: string; readonly fragment?: string } {
  const index = value.indexOf('#');
  if (index < 0) return { path: value };
  return {
    path: value.slice(0, index),
    fragment: decode(value.slice(index + 1)),
  };
}

function normalizeWindowsPath(value: string): string {
  return value.replaceAll('/', '\\');
}

function isWindowsAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value);
}

function pathDirectory(value: string): string {
  const normalized = normalizeWindowsPath(value);
  const separator = normalized.lastIndexOf('\\');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function collapsePath(value: string): string {
  const normalized = normalizeWindowsPath(value);
  const prefix = normalized.startsWith('\\\\')
    ? '\\\\'
    : /^[A-Za-z]:/u.test(normalized)
      ? normalized.slice(0, 2)
      : '';
  const remainder = normalized.slice(prefix.length).replace(/^\\+/u, '');
  const segments: string[] = [];
  for (const segment of remainder.split('\\')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop();
      else if (!prefix) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join('\\');
  if (prefix === '\\\\') return `${prefix}${joined}`;
  if (prefix) return `${prefix}\\${joined}`;
  return joined;
}

function resolveFileUri(rawPath: string): string | null {
  if (!/^file:/iu.test(rawPath)) return null;
  try {
    const uri = new URL(rawPath);
    if (uri.protocol !== 'file:') return null;
    const pathname = decode(uri.pathname);
    if (uri.hostname && uri.hostname !== 'localhost') {
      return collapsePath(`\\\\${uri.hostname}${pathname}`);
    }
    // file:///C:/docs/readme.md is represented as /C:/docs/readme.md.
    return collapsePath(pathname.replace(/^\/(?=[A-Za-z]:)/u, ''));
  } catch {
    return null;
  }
}

/** Converts a generated heading id or URL fragment to the same stable form. */
export function normalizeMarkdownFragment(fragment: string): string {
  return decode(fragment)
    .replace(/^#/u, '')
    .toLocaleLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/gu, '-');
}

export function resolveMarkdownLink(
  href: string,
  documentPath: string,
  workspacePath?: string,
): MarkdownLinkResolution {
  const target = href.trim();
  if (!target) return { kind: 'invalid', reason: 'The link destination is empty.' };

  if (target.startsWith('#')) {
    const fragment = normalizeMarkdownFragment(target.slice(1));
    return fragment
      ? { kind: 'anchor', fragment }
      : { kind: 'invalid', reason: 'The heading anchor is empty.' };
  }

  try {
    const parsed = new URL(target);
    if (EXTERNAL_PROTOCOLS.has(parsed.protocol)) return { kind: 'external', url: target };
    if (parsed.protocol !== 'file:') {
      return { kind: 'invalid', reason: `The ${parsed.protocol} link protocol is not allowed.` };
    }
  } catch {
    // Relative and Windows paths are intentionally not URL-parsed.
  }

  const { path: rawPath, fragment: rawFragment } = splitFragment(target);
  const fileUriPath = resolveFileUri(rawPath);
  const decodedPath = fileUriPath ?? decode(rawPath).replace(/^\?[^/\\]*/u, '');
  const withoutQuery = decodedPath.split('?')[0] ?? decodedPath;
  const base = documentPath ? pathDirectory(documentPath) : workspacePath || '';
  if (!base) {
    return { kind: 'invalid', reason: 'Save the document before opening a relative link.' };
  }
  const candidate = isWindowsAbsolute(withoutQuery) ? withoutQuery : `${base}\\${withoutQuery}`;
  const resolved = collapsePath(candidate);
  if (!resolved) return { kind: 'invalid', reason: 'The linked document path is empty.' };
  const fragment = rawFragment ? normalizeMarkdownFragment(rawFragment) : undefined;
  return fragment ? { kind: 'document', path: resolved, fragment } : { kind: 'document', path: resolved };
}
