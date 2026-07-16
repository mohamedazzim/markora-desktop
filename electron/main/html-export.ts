import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import hljs from 'highlight.js';
import katex from 'katex';
import { Marked, Renderer, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type {
  HtmlExportFileResult,
  HtmlExportMetadata,
  HtmlExportOptions,
  HtmlExportResult,
  HtmlExportTheme,
  HtmlExportWarning,
} from '../../src/shared/html-export';

export interface HtmlExportPathContext {
  sourcePath?: string;
  workspaceRoot?: string;
  outputPath?: string;
  maxEmbeddedImageBytes?: number;
  /** Main-process authority check for a user-selected asset outside the document roots. */
  isLocalPathAllowed?: (candidate: string) => boolean;
}

interface HeadingRecord {
  depth: number;
  id: string;
  text: string;
}

interface ProtectedMath {
  token: string;
  html: string;
  display: boolean;
}

const MAX_EMBEDDED_IMAGE_BYTES = 25 * 1024 * 1024;
const HTML_EXPORT_THEMES: readonly HtmlExportTheme[] = [
  'markora-light',
  'markora-dark',
  'github-light',
  'github-dark',
  'print',
];

const imageMimeTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const baseStyles = String.raw`
:root{color-scheme:light;--mk-bg:#fff;--mk-fg:#24292f;--mk-muted:#59636e;--mk-border:#d0d7de;--mk-code:#f6f8fa;--mk-link:#0969da;--mk-quote:#57606a;--mk-accent:#0969da}
*{box-sizing:border-box}html{font-size:16px;background:var(--mk-bg);color:var(--mk-fg)}body{margin:0;background:var(--mk-bg);color:var(--mk-fg);font:400 1rem/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:break-word}.markora-document{max-width:860px;margin:0 auto;padding:48px 40px 80px}.markora-document>:first-child{margin-top:0}.markora-document>:last-child{margin-bottom:0}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.65em 0 .65em;font-weight:650;scroll-margin-top:1rem}h1,h2{border-bottom:1px solid var(--mk-border);padding-bottom:.3em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.875em}h6{font-size:.85em;color:var(--mk-muted)}.heading-anchor{color:inherit;text-decoration:none}.heading-anchor:hover:after{content:" #";color:var(--mk-accent);font-weight:400}
a{color:var(--mk-link);text-decoration-thickness:.08em;text-underline-offset:.16em}img{display:block;max-width:100%;height:auto;margin:1.25rem auto}p,ul,ol,blockquote,pre,table{margin:0 0 1rem}blockquote{margin-left:0;padding:.2rem 1rem;color:var(--mk-quote);border-left:.25rem solid var(--mk-border)}hr{height:.25rem;padding:0;margin:1.5rem 0;background:var(--mk-border);border:0}
code,kbd,pre{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}code{font-size:.875em;background:var(--mk-code);border-radius:4px;padding:.16em .35em}pre{overflow:auto;padding:1rem;background:var(--mk-code);border:1px solid var(--mk-border);border-radius:7px;line-height:1.5}pre code{font-size:.875rem;background:transparent;padding:0;border-radius:0}.mermaid{background:transparent;text-align:center;border:0}.math-block{overflow:auto;padding:.5rem 0;text-align:center}
table{display:block;width:max-content;max-width:100%;overflow:auto;border-spacing:0;border-collapse:collapse}th,td{padding:.45rem .8rem;border:1px solid var(--mk-border)}th{font-weight:650;background:var(--mk-code)}tr:nth-child(2n) td{background:color-mix(in srgb,var(--mk-code) 55%,transparent)}input[type=checkbox]{margin-right:.45em}.task-list-item{list-style:none}.contains-task-list{padding-left:1.25rem}
.markora-toc{margin:0 0 2rem;padding:1rem 1.25rem;border:1px solid var(--mk-border);border-radius:8px;background:var(--mk-code)}.markora-toc h2{font-size:1rem;margin:0 0 .65rem;padding:0;border:0}.markora-toc ol{margin:0;padding-left:1.4rem}.markora-toc li{margin:.25rem 0}.markora-toc a{text-decoration:none}
@media(max-width:700px){.markora-document{padding:24px 20px 48px}}@media print{html,body{background:#fff!important;color:#000!important}.markora-document{max-width:none;margin:0;padding:0}a{color:inherit}pre,blockquote,table,img,.math-block,.mermaid{break-inside:avoid}h1,h2,h3,h4,h5,h6{break-after:avoid}.heading-anchor:hover:after{content:""}}
`;

const themeStyles: Readonly<Record<HtmlExportTheme, string>> = {
  'markora-light': '',
  'github-light':
    ':root{--mk-bg:#ffffff;--mk-fg:#1f2328;--mk-muted:#656d76;--mk-border:#d0d7de;--mk-code:#f6f8fa;--mk-link:#0969da;--mk-quote:#59636e;--mk-accent:#0969da}',
  'markora-dark':
    ':root{color-scheme:dark;--mk-bg:#111827;--mk-fg:#e5e7eb;--mk-muted:#9ca3af;--mk-border:#374151;--mk-code:#1f2937;--mk-link:#7dd3fc;--mk-quote:#a5b4fc;--mk-accent:#38bdf8}',
  'github-dark':
    ':root{color-scheme:dark;--mk-bg:#0d1117;--mk-fg:#e6edf3;--mk-muted:#8d96a0;--mk-border:#30363d;--mk-code:#161b22;--mk-link:#2f81f7;--mk-quote:#8b949e;--mk-accent:#58a6ff}',
  print:
    ':root{--mk-bg:#fff;--mk-fg:#111;--mk-muted:#444;--mk-border:#aaa;--mk-code:#f4f4f4;--mk-link:#0645ad;--mk-quote:#333;--mk-accent:#0645ad}.markora-document{max-width:190mm;padding:15mm 10mm}',
};

let cachedMermaidRuntime: Promise<string> | undefined;
let cachedKatexCss: Promise<string> | undefined;
const cachedHighlightCss = new Map<'light' | 'dark', Promise<string>>();

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|#39);/g,
      (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity] ?? entity,
    )
    .trim();
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(
    /&(?:amp|quot|#39|lt|gt);/g,
    (entity) => ({ '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' })[entity] ?? entity,
  );
}

function slugBase(value: string): string {
  return (
    stripHtml(value)
      .toLocaleLowerCase()
      .replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

function extractFrontMatter(markdown: string): { body: string; metadata: HtmlExportMetadata } {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return { body: markdown.replace(/^\uFEFF/, ''), metadata: {} };
  const metadata: HtmlExportMetadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^\s*(title|author|description|date|language|lang)\s*:\s*(.*?)\s*$/i.exec(line);
    if (!pair) continue;
    const key = pair[1].toLocaleLowerCase() === 'lang' ? 'language' : pair[1].toLocaleLowerCase();
    let value = pair[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) metadata[key as keyof HtmlExportMetadata] = value.slice(0, 500);
  }
  return { body: markdown.slice(match[0].length), metadata };
}

function protectMath(markdown: string, enabled: boolean): { source: string; math: ProtectedMath[] } {
  if (!enabled) return { source: markdown, math: [] };
  const math: ProtectedMath[] = [];
  const fences: string[] = [];
  const fenced = markdown.replace(
    /^ {0,3}(```+|~~~+)([^\r\n]*)\r?\n([\s\S]*?)\r?\n {0,3}\1[ \t]*$/gm,
    (block, _marker: string, info: string, body: string) => {
      if (/^\s*(?:math|latex|tex)\s*$/i.test(info)) {
        const token = `MARKORA_MATH_BLOCK_${math.length}_TOKEN`;
        math.push({
          token,
          html: katex.renderToString(body.trim(), {
            displayMode: true,
            throwOnError: false,
            output: 'htmlAndMathml',
            strict: 'warn',
            trust: false,
          }),
          display: true,
        });
        return token;
      }
      const token = `MARKORA_PROTECTED_FENCE_${fences.length}_TOKEN`;
      fences.push(block);
      return token;
    },
  );
  const blocks = fenced.replace(
    /^ {0,3}\$\$[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}\$\$[ \t]*$/gm,
    (_block, expression: string) => {
      const token = `MARKORA_MATH_BLOCK_${math.length}_TOKEN`;
      math.push({
        token,
        html: katex.renderToString(expression.trim(), {
          displayMode: true,
          throwOnError: false,
          output: 'htmlAndMathml',
          strict: 'warn',
          trust: false,
        }),
        display: true,
      });
      return token;
    },
  );
  const inline = blocks.replace(/(?<!\\)\$([^$\r\n]+?)(?<!\\)\$/g, (_block, expression: string) => {
    const token = `MARKORA_MATH_INLINE_${math.length}_TOKEN`;
    math.push({
      token,
      html: katex.renderToString(expression.trim(), {
        displayMode: false,
        throwOnError: false,
        output: 'htmlAndMathml',
        strict: 'warn',
        trust: false,
      }),
      display: false,
    });
    return token;
  });
  return {
    source: inline.replace(
      /MARKORA_PROTECTED_FENCE_(\d+)_TOKEN/g,
      (_token, index: string) => fences[Number(index)] ?? '',
    ),
    math,
  };
}

function restoreMath(html: string, math: readonly ProtectedMath[]): string {
  let output = html;
  for (const item of math) {
    const replacement = item.display ? `<div class="math-block">${item.html}</div>` : item.html;
    if (item.display) output = output.replace(`<p>${item.token}</p>`, replacement);
    output = output.replaceAll(item.token, replacement);
  }
  return output;
}

function renderTableOfContents(headings: readonly HeadingRecord[]): string {
  if (!headings.length) return '';
  const minimumDepth = Math.min(...headings.map((heading) => heading.depth));
  let depth = minimumDepth;
  let output = '<nav class="markora-toc" aria-label="Table of contents"><h2>Table of contents</h2><ol>';
  headings.forEach((heading, index) => {
    if (index > 0) {
      if (heading.depth > depth) output += '<ol>'.repeat(heading.depth - depth);
      else if (heading.depth < depth) output += `</li></ol>`.repeat(depth - heading.depth) + '</li>';
      else output += '</li>';
    }
    output += `<li><a href="#${escapeAttribute(heading.id)}">${escapeHtml(heading.text)}</a>`;
    depth = heading.depth;
  });
  output += `</li></ol>`.repeat(Math.max(0, depth - minimumDepth)) + '</li></ol></nav>';
  return output;
}

function createMarkdownRenderer(options: HtmlExportOptions, headings: HeadingRecord[]): Marked {
  const renderer = new Renderer();
  const seenSlugs = new Map<string, number>();
  renderer.heading = function ({ tokens, depth, text }: Tokens.Heading): string {
    const inner = this.parser.parseInline(tokens);
    const label = stripHtml(text || inner);
    const base = slugBase(label);
    const count = seenSlugs.get(base) ?? 0;
    seenSlugs.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    headings.push({ depth, id, text: label });
    return `<h${depth} id="${escapeAttribute(id)}"><a class="heading-anchor" href="#${escapeAttribute(id)}">${inner}</a></h${depth}>\n`;
  };
  renderer.code = ({ text, lang }: Tokens.Code): string => {
    const language = (lang ?? '').trim().split(/\s+/)[0].toLocaleLowerCase();
    if (language === 'mermaid' && options.renderMermaid) {
      return `<pre class="mermaid" data-language="mermaid">${escapeHtml(text)}</pre>\n`;
    }
    if (options.syntaxHighlighting && language && hljs.getLanguage(language)) {
      const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      return `<pre><code class="hljs language-${escapeAttribute(language.replace(/[^a-z0-9_+-]/gi, ''))}">${highlighted}</code></pre>\n`;
    }
    const className = language
      ? ` class="language-${escapeAttribute(language.replace(/[^a-z0-9_+-]/gi, ''))}"`
      : '';
    return `<pre><code${className}>${escapeHtml(text)}</code></pre>\n`;
  };
  renderer.link = function (token: Tokens.Link): string {
    const label = this.parser.parseInline(token.tokens);
    const href = token.href.trim();
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
    return `<a href="${escapeAttribute(href)}"${title}>${label}</a>`;
  };
  return new Marked({ gfm: true, breaks: false, async: false, renderer });
}

function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'article',
      'aside',
      'details',
      'figcaption',
      'figure',
      'footer',
      'header',
      'input',
      'main',
      'img',
      'mark',
      'nav',
      'section',
      'summary',
      'u',
      's',
      'del',
      'ins',
      'kbd',
      'math',
      'semantics',
      'annotation',
      'mrow',
      'mi',
      'mn',
      'mo',
      'mspace',
      'mtext',
      'msup',
      'msub',
      'msubsup',
      'mfrac',
      'msqrt',
      'mroot',
      'mtable',
      'mtr',
      'mtd',
      'mover',
      'munder',
      'munderover',
      'mpadded',
      'mphantom',
      'menclose',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'dir'],
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'align', 'data-align', 'loading'],
      code: ['class'],
      pre: ['class', 'data-language'],
      input: ['type', 'checked', 'disabled'],
      ol: ['start', 'type'],
      td: ['align', 'colspan', 'rowspan'],
      th: ['align', 'colspan', 'rowspan', 'scope'],
      annotation: ['encoding'],
      math: ['xmlns', 'display'],
      mspace: ['width', 'height', 'depth'],
      mo: ['stretchy', 'fence', 'separator', 'lspace', 'rspace'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attributes) => {
        const href = attributes.href ?? '';
        if (/^https?:/i.test(href))
          return { tagName, attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' } };
        return { tagName, attribs: attributes };
      },
      input: (tagName, attributes) => {
        const attribs: Record<string, string> =
          attributes.type === 'checkbox'
            ? { ...attributes, disabled: 'disabled' }
            : { type: 'checkbox', disabled: 'disabled' };
        return { tagName, attribs };
      },
    },
  });
}

function portableRelativePath(from: string, to: string): string {
  // Keep path calculations stable when a Windows realpath is compared with a
  // path supplied by a dialog (and when tests exercise Windows paths from a
  // non-Windows host). Both path implementations use the same slash form.
  const windowsStyle =
    process.platform === 'win32' || /^(?:[a-z]:[\\/]|\\\\)/i.test(from) || /^(?:[a-z]:[\\/]|\\\\)/i.test(to);
  const normalize = (value: string) => {
    const slashPath = value.replace(/\\/g, '/');
    return windowsStyle ? slashPath.toLocaleLowerCase() : slashPath;
  };
  return path.posix.relative(normalize(from), normalize(to));
}

function isInside(root: string, candidate: string): boolean {
  // Windows realpath can return a different drive-letter or component case
  // than the user-selected source/workspace path. Compare normalized forms so
  // an authorized file is not misclassified as outside its own root.
  const relative = portableRelativePath(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !relative.startsWith('/'));
}

function relativePath(from: string, to: string): string {
  return portableRelativePath(from, to);
}

function isWindowsStylePath(...values: string[]): boolean {
  return process.platform === 'win32' || values.some((value) => /^(?:[a-z]:[\\/]|\\\\)/i.test(value));
}

function resolvePortable(...values: string[]): string {
  return isWindowsStylePath(...values) ? path.win32.resolve(...values) : path.resolve(...values);
}

function dirnamePortable(value: string): string {
  return isWindowsStylePath(value) ? path.win32.dirname(value) : path.dirname(value);
}

async function existingRealPath(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return resolvePortable(candidate);
  }
}

function encodeRelativePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => (segment === '..' || segment === '.' ? segment : encodeURIComponent(segment)))
    .join('/');
}

function isSafeDataImage(source: string): boolean {
  return (
    /^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(source) &&
    source.length <= MAX_EMBEDDED_IMAGE_BYTES * 1.4
  );
}

function parseLocalImagePath(source: string, context: HtmlExportPathContext): string | undefined {
  let cleanSource = decodeHtmlAttribute(source).trim();
  if (!cleanSource) return undefined;
  if (/^file:/i.test(cleanSource)) {
    try {
      return fileURLToPath(cleanSource);
    } catch {
      return undefined;
    }
  }
  if (path.win32.isAbsolute(cleanSource) || path.posix.isAbsolute(cleanSource)) {
    if (/^[\\/]/.test(cleanSource) && !/^[a-z]:/i.test(cleanSource) && context.workspaceRoot) {
      return resolvePortable(context.workspaceRoot, cleanSource.replace(/^[\\/]+/, ''));
    }
    return resolvePortable(cleanSource);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(cleanSource) || cleanSource.startsWith('//')) return undefined;
  cleanSource = cleanSource.split(/[?#]/, 1)[0];
  try {
    cleanSource = decodeURIComponent(cleanSource);
  } catch {
    /* preserve a literal percent */
  }
  const windowsStyle = isWindowsStylePath(context.sourcePath ?? '', context.workspaceRoot ?? '', cleanSource);
  cleanSource = cleanSource.replace(/\//g, windowsStyle ? '\\' : path.sep);
  const root = context.sourcePath ? dirnamePortable(context.sourcePath) : context.workspaceRoot;
  return root ? resolvePortable(root, cleanSource) : undefined;
}

async function prepareImageSources(
  html: string,
  options: HtmlExportOptions,
  context: HtmlExportPathContext,
  warnings: HtmlExportWarning[],
): Promise<{ html: string; sources: Map<string, string>; embeddedImageCount: number }> {
  const sources = new Map<string, string>();
  let embeddedImageCount = 0;
  let imageIndex = 0;
  let result = '';
  let cursor = 0;
  const matcher = /<img\b[^>]*>/gis;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(html)) !== null) {
    result += html.slice(cursor, match.index);
    const tag = match[0];
    const sourceMatch = /\bsrc\s*=\s*(["'])(.*?)\1/is.exec(tag);
    if (!sourceMatch) {
      result += tag;
      cursor = matcher.lastIndex;
      continue;
    }
    const originalSource = decodeHtmlAttribute(sourceMatch[2]).trim();
    const token = `markora-image-source-${imageIndex++}.invalid`;
    let safeSource = '';
    if (/^https?:\/\//i.test(originalSource)) {
      try {
        const url = new URL(originalSource);
        if (url.protocol === 'http:' || url.protocol === 'https:') safeSource = url.href;
      } catch {
        /* reported below */
      }
    } else if (/^data:/i.test(originalSource)) {
      if (isSafeDataImage(originalSource)) safeSource = originalSource.replace(/\s/g, '');
    } else {
      const localPath = parseLocalImagePath(originalSource, context);
      const explicitlyUnsafeUrl =
        /^[a-z][a-z\d+.-]*:/i.test(originalSource) || originalSource.startsWith('//');
      if (
        !localPath &&
        !explicitlyUnsafeUrl &&
        !context.sourcePath &&
        !context.workspaceRoot &&
        !path.isAbsolute(originalSource)
      ) {
        safeSource = encodeRelativePath(originalSource);
        if (options.embedLocalImages) {
          warnings.push({
            code: 'IMAGE_CONTEXT_REQUIRED',
            message:
              'A relative image could not be embedded until the Markdown document has a saved location.',
            source: originalSource,
          });
        }
      } else if (localPath) {
        const roots = [
          context.sourcePath ? dirnamePortable(context.sourcePath) : undefined,
          context.workspaceRoot,
        ].filter((root): root is string => Boolean(root));
        const [realCandidate, ...realRoots] = await Promise.all([
          existingRealPath(localPath),
          ...roots.map(existingRealPath),
        ]);
        const approvedByRoot = realRoots.some(
          (root) => isInside(root, realCandidate) || isInside(root, localPath),
        );
        const explicitlyApproved =
          (context.isLocalPathAllowed?.(realCandidate) ?? false) ||
          // Keep the callback ergonomic for callers that compare against the
          // resolved source path rather than fs.realpath's canonical spelling.
          (context.isLocalPathAllowed?.(localPath) ?? false);
        if (!approvedByRoot && !explicitlyApproved) {
          warnings.push({
            code: 'IMAGE_OUTSIDE_ALLOWED_ROOTS',
            message: 'A local image was outside the document or workspace boundary and was not read.',
            source: originalSource,
          });
        } else {
          try {
            const stat = await fs.stat(realCandidate);
            if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
            const mimeType = imageMimeTypes[path.extname(realCandidate).toLocaleLowerCase()];
            if (!mimeType) {
              warnings.push({
                code: 'IMAGE_UNSUPPORTED_TYPE',
                message: 'Only PNG, JPEG, GIF, WebP, BMP, and AVIF images can be embedded.',
                source: originalSource,
              });
            } else if (stat.size > (context.maxEmbeddedImageBytes ?? MAX_EMBEDDED_IMAGE_BYTES)) {
              warnings.push({
                code: 'IMAGE_TOO_LARGE',
                message: `The image exceeded the ${context.maxEmbeddedImageBytes ?? MAX_EMBEDDED_IMAGE_BYTES} byte embedding limit.`,
                source: originalSource,
              });
            } else if (options.embedLocalImages) {
              safeSource = `data:${mimeType};base64,${(await fs.readFile(realCandidate)).toString('base64')}`;
              embeddedImageCount += 1;
            } else if (context.outputPath) {
              safeSource = encodeRelativePath(relativePath(dirnamePortable(context.outputPath), localPath));
            } else {
              safeSource = encodeRelativePath(
                relativePath(
                  context.sourcePath ? dirnamePortable(context.sourcePath) : context.workspaceRoot!,
                  realCandidate,
                ),
              );
            }
          } catch (error) {
            const code = (error as { code?: string }).code;
            warnings.push({
              code: code === 'ENOENT' ? 'IMAGE_NOT_FOUND' : 'IMAGE_READ_FAILED',
              message:
                code === 'ENOENT'
                  ? 'A referenced local image could not be found.'
                  : `A referenced local image could not be read: ${(error as Error).message}`,
              source: originalSource,
            });
            safeSource = encodeRelativePath(originalSource);
          }
        }
      }
    }
    if (!safeSource) {
      warnings.push({
        code: 'IMAGE_URL_REJECTED',
        message: 'An unsafe or invalid image URL was removed from the export.',
        source: originalSource,
      });
    } else {
      sources.set(token, safeSource);
    }
    result += tag.replace(sourceMatch[0], `src="${token}"`);
    cursor = matcher.lastIndex;
  }
  result += html.slice(cursor);
  return { html: result, sources, embeddedImageCount };
}

function restoreImageSources(html: string, sources: ReadonlyMap<string, string>): string {
  let output = html;
  for (const [token, source] of sources) output = output.replaceAll(token, escapeAttribute(source));
  return output.replace(/\s+src="markora-image-source-\d+\.invalid"/g, '');
}

async function readHighlightCss(theme: HtmlExportTheme): Promise<string> {
  const variant: 'light' | 'dark' = theme.includes('dark') ? 'dark' : 'light';
  let pending = cachedHighlightCss.get(variant);
  if (!pending) {
    const filename = variant === 'dark' ? 'github-dark.css' : 'github.css';
    pending = fs.readFile(require.resolve(`highlight.js/styles/${filename}`), 'utf8');
    cachedHighlightCss.set(variant, pending);
  }
  return pending;
}

async function readKatexCssWithEmbeddedFonts(): Promise<string> {
  if (!cachedKatexCss) {
    cachedKatexCss = (async () => {
      const cssPath = require.resolve('katex/dist/katex.min.css');
      const directory = path.dirname(cssPath);
      const css = await fs.readFile(cssPath, 'utf8');
      const urls = Array.from(
        new Set(Array.from(css.matchAll(/url\(([^)]+)\)/g), (match) => match[1].replace(/["']/g, ''))),
      );
      let output = css;
      for (const relativeUrl of urls) {
        if (!relativeUrl.startsWith('fonts/')) continue;
        const font = await fs.readFile(path.join(directory, relativeUrl));
        const mime = relativeUrl.endsWith('.woff2')
          ? 'font/woff2'
          : relativeUrl.endsWith('.woff')
            ? 'font/woff'
            : 'application/octet-stream';
        output = output.replaceAll(relativeUrl, `data:${mime};base64,${font.toString('base64')}`);
      }
      return output;
    })();
  }
  return cachedKatexCss;
}

async function readMermaidRuntime(): Promise<string> {
  if (!cachedMermaidRuntime)
    cachedMermaidRuntime = fs.readFile(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
  return cachedMermaidRuntime;
}

async function buildEmbeddedCss(options: HtmlExportOptions, hasMath: boolean): Promise<string> {
  if (!options.embedCss) return '';
  const parts: string[] = [];
  if (options.styling === 'styled') parts.push(baseStyles, themeStyles[options.theme]);
  if (options.syntaxHighlighting) parts.push(await readHighlightCss(options.theme));
  if (hasMath && options.renderMath) parts.push(await readKatexCssWithEmbeddedFonts());
  return parts.join('\n');
}

function buildMetadata(metadata: HtmlExportMetadata): string {
  const tags: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
  ];
  if (metadata.author) tags.push(`<meta name="author" content="${escapeAttribute(metadata.author)}">`);
  if (metadata.description)
    tags.push(`<meta name="description" content="${escapeAttribute(metadata.description)}">`);
  if (metadata.date) tags.push(`<meta name="date" content="${escapeAttribute(metadata.date)}">`);
  return tags.join('\n');
}

function validateOptions(options: HtmlExportOptions): void {
  if (!HTML_EXPORT_THEMES.includes(options.theme))
    throw new Error(`Unsupported HTML export theme: ${String(options.theme)}`);
  if (options.styling !== 'styled' && options.styling !== 'unstyled')
    throw new Error('Unsupported HTML styling mode.');
}

export async function renderHtmlExport(
  markdown: string,
  options: HtmlExportOptions,
  context: HtmlExportPathContext = {},
): Promise<HtmlExportResult> {
  validateOptions(options);
  if (Buffer.byteLength(markdown, 'utf8') > 20_000_000)
    throw new Error('Markdown input exceeds the 20 MB HTML export limit.');
  const warnings: HtmlExportWarning[] = [];
  const frontMatter = extractFrontMatter(markdown);
  const metadata = { ...frontMatter.metadata, ...(options.metadata ?? {}) };
  const protectedMath = protectMath(frontMatter.body, options.renderMath);
  const headings: HeadingRecord[] = [];
  const parser = createMarkdownRenderer(options, headings);
  const rendered = parser.parse(protectedMath.source);
  if (typeof rendered !== 'string')
    throw new Error('Asynchronous Markdown rendering is not supported by the HTML exporter.');
  for (const match of rendered.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(\/\/.*?)\1/gi)) {
    warnings.push({
      code: 'IMAGE_URL_REJECTED',
      message: 'Protocol-relative image URLs are not permitted in exported documents.',
      source: decodeHtmlAttribute(match[2]),
    });
  }
  const preparedImages = await prepareImageSources(rendered, options, context, warnings);
  let body = restoreImageSources(sanitizeBody(preparedImages.html), preparedImages.sources);
  body = body.replace(/(<img\b[^>]*?)\s+src\s*=\s*(["'])\/\/.*?\2([^>]*>)/gis, '$1$3');
  body = restoreMath(body, protectedMath.math);
  const hasMath = protectedMath.math.length > 0;
  const hasMermaid = options.renderMermaid && /<pre class="mermaid"/.test(body);
  if (options.includeTableOfContents) body = `${renderTableOfContents(headings)}${body}`;
  body = `<article class="markora-document">${body}</article>`;

  if (!options.standalone) {
    const css = await buildEmbeddedCss(options, hasMath);
    if (!options.embedCss && options.styling === 'styled')
      warnings.push({
        code: 'CSS_NOT_EMBEDDED',
        message: 'The styled fragment omits CSS because CSS embedding is disabled.',
      });
    return {
      html: css ? `<style>${css}</style>${body}` : body,
      warnings,
      embeddedImageCount: preparedImages.embeddedImageCount,
      headingCount: headings.length,
      hasMath,
      hasMermaid,
    };
  }

  const css = await buildEmbeddedCss(options, hasMath);
  if (!options.embedCss && options.styling === 'styled')
    warnings.push({
      code: 'CSS_NOT_EMBEDDED',
      message: 'The standalone document omits CSS because CSS embedding is disabled.',
    });
  let mermaidScript = '';
  if (hasMermaid) {
    try {
      const runtime = (await readMermaidRuntime()).replace(/<\/script/gi, '<\\/script');
      const theme = options.theme.includes('dark') ? 'dark' : 'neutral';
      mermaidScript = `<script>${runtime}</script><script>mermaid.initialize({startOnLoad:true,securityLevel:'strict',theme:'${theme}',suppressErrorRendering:false});</script>`;
    } catch (error) {
      warnings.push({
        code: 'MERMAID_RUNTIME_UNAVAILABLE',
        message: `Mermaid source was exported, but its local rendering runtime could not be embedded: ${(error as Error).message}`,
      });
    }
  }
  const language = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(metadata.language ?? '')
    ? metadata.language!
    : 'en';
  const title = metadata.title || headings[0]?.text || 'Markora document';
  const csp =
    "default-src 'none'; img-src data: https: http: file:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; media-src data: https: http:; object-src 'none'; base-uri 'none'; form-action 'none'";
  const document = `<!doctype html>\n<html lang="${escapeAttribute(language)}"><head>\n${buildMetadata(metadata)}\n<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">\n<title>${escapeHtml(title)}</title>${css ? `\n<style>${css}</style>` : ''}\n</head><body>${body}${mermaidScript}</body></html>\n`;
  return {
    html: document,
    warnings,
    embeddedImageCount: preparedImages.embeddedImageCount,
    headingCount: headings.length,
    hasMath,
    hasMermaid,
  };
}

export async function writeHtmlExport(
  outputPath: string,
  markdown: string,
  options: HtmlExportOptions,
  context: Omit<HtmlExportPathContext, 'outputPath'> = {},
): Promise<HtmlExportFileResult> {
  const resolvedOutput = path.resolve(outputPath);
  if (!/\.html?$/i.test(resolvedOutput))
    throw new Error('HTML export output must use an .html or .htm extension.');
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  const result = await renderHtmlExport(markdown, options, { ...context, outputPath: resolvedOutput });
  const temporary = path.join(
    path.dirname(resolvedOutput),
    `.${path.basename(resolvedOutput)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, result.html, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, resolvedOutput);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    path: resolvedOutput,
    byteLength: Buffer.byteLength(result.html, 'utf8'),
    warnings: result.warnings,
    embeddedImageCount: result.embeddedImageCount,
    headingCount: result.headingCount,
    hasMath: result.hasMath,
    hasMermaid: result.hasMermaid,
  };
}

/** Test hook used to prove the shipped runtimes exist without exporting cache internals. */
export function htmlExportRuntimePaths(): {
  katexCss: string;
  mermaid: string;
  highlightLight: string;
  highlightDark: string;
} {
  const paths = {
    katexCss: require.resolve('katex/dist/katex.min.css'),
    mermaid: require.resolve('mermaid/dist/mermaid.min.js'),
    highlightLight: require.resolve('highlight.js/styles/github.css'),
    highlightDark: require.resolve('highlight.js/styles/github-dark.css'),
  };
  for (const runtimePath of Object.values(paths)) {
    if (!fsSync.existsSync(runtimePath)) throw new Error(`HTML export runtime is missing: ${runtimePath}`);
  }
  return paths;
}
