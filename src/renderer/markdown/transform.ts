import DOMPurify from 'dompurify';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import remarkStringify from 'remark-stringify';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { Root } from 'mdast';
import katex from 'katex';

export type MarkdownTree = ReturnType<typeof parseMarkdown>;
export interface HeadingAnchor {
  depth: number;
  text: string;
  line: number;
  id: string;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']).use(remarkMath);
const serializer = unified()
  .use(remarkStringify)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkMath);
const escapeHtml = (value: string) =>
  value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
const escapeAttribute = (value: string) => escapeHtml(value).replace(/"/g, '&quot;');

export function parseMarkdown(source: string) {
  return parser.runSync(parser.parse(source));
}
export function serializeMarkdown(tree: MarkdownTree): string {
  return String(serializer.stringify(tree as Root));
}
export function normalizeMarkdown(source: string): string {
  return serializeMarkdown(parseMarkdown(source));
}

export function headingAnchors(source: string): HeadingAnchor[] {
  const seen = new Map<string, number>();
  const anchors: HeadingAnchor[] = [];
  const lines = source.split(/\r?\n/);
  const append = (depth: number, text: string, line: number) => {
    const base =
      text
        .toLocaleLowerCase()
        .replace(/<[^>]*>/g, '')
        .replace(/[`*_~]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    anchors.push({ depth, text, line, id: count ? `${base}-${count}` : base });
  };

  lines.forEach((line, index) => {
    const atx = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) {
      append(atx[1].length, atx[2], index + 1);
      return;
    }
    if (index === 0 || !line.trim()) return;
    const setext = /^ {0,3}(=+|-+)\s*$/.exec(line);
    const title = lines[index - 1].trim();
    if (setext && title && !/^(?:```|~~~|>|[-+*]\s)/.test(title)) {
      append(setext[1][0] === '=' ? 1 : 2, title, index);
    }
  });
  return anchors;
}

/** Converts Markdown to a safe HTML representation that Tiptap can parse. */
export function markdownToStructuredHtml(source: string): string {
  const fences: string[] = [];
  const protect = (kind: string, body: string, attributes = '') => {
    const token = `MARKORA_FENCE_${fences.length}_TOKEN`;
    fences.push(`<pre data-markora-fence="${kind}"${attributes}>${escapeHtml(body)}</pre>`);
    return token;
  };
  const protectInline = (kind: string, body: string) =>
    `<span data-markora-inline="${kind}">${escapeHtml(body)}</span>`;
  const withFrontMatter = source.replace(
    /^(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/,
    (_all, delimiter: string, body: string) =>
      `${protect('frontmatter', body, ` data-markora-delimiter="${delimiter}"`)}\n`,
  );
  const protectedSource = withFrontMatter
    .replace(
      /^ {0,3}(?:```|~~~)\s*(mermaid|math)\s*\r?\n([\s\S]*?)^ {0,3}(?:```|~~~)\s*$/gim,
      (_all, language: string, body: string) => {
        return protect(language.toLowerCase(), body.trimEnd());
      },
    )
    .replace(/^ {0,3}\$\$[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}\$\$[ \t]*$/gm, (_all, body: string) =>
      protect('displaymath', body.trimEnd()),
    )
    .replace(/^\[\^[^\]]+\]:[^\r\n]*(?:\r?\n(?:(?: {2,}|\t)[^\r\n]*|[ \t]*))*/gm, (block) =>
      protect('footnote', block),
    )
    .replace(/\[\^[^\]\r\n]+\]/g, (reference) => protectInline('footnote-reference', reference))
    .replace(/<!--([\s\S]*?)-->/g, (block) => protect('rawhtml', block))
    .replace(/<(details|div|section|aside|figure|video|audio|table)\b[\s\S]*?<\/\1>/gi, (block) =>
      protect('rawhtml', block),
    );
  const blockSeparatedSource = protectedSource.replace(
    /MARKORA_FENCE_\d+_TOKEN/g,
    (token) => `\n\n${token}\n\n`,
  );
  const html = marked.parse(blockSeparatedSource, { gfm: true, breaks: true }) as string;
  const withFences = html
    .replace(/<p>MARKORA_FENCE_(\d+)_TOKEN<\/p>/g, (_all, index) => fences[Number(index)] || '')
    .replace(
      /<pre><code class="language-(mermaid|math)">([\s\S]*?)<\/code><\/pre>/gi,
      (_all, language: string, body: string) =>
        `<pre data-markora-fence="${language.toLowerCase()}">${body}</pre>`,
    );
  return DOMPurify.sanitize(withFences, {
    ADD_TAGS: ['input', 'details', 'summary', 'mark', 'u'],
    ADD_ATTR: [
      'checked',
      'disabled',
      'type',
      'class',
      'title',
      'width',
      'height',
      'align',
      'data-align',
      'data-markora-fence',
      'data-markora-delimiter',
      'data-markora-inline',
      'data-checked',
    ],
  });
}

/** Converts structured-editor HTML back to portable Markdown. */
export function structuredHtmlToMarkdown(html: string): string {
  const service = new TurndownService({
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    bulletListMarker: '-',
    headingStyle: 'atx',
    hr: '---',
  });
  service.use(gfm);
  service.addRule('markoraImage', {
    filter: ['img'],
    replacement: (_content, node) => {
      const source = node.getAttribute('src') || '';
      if (!source) return '';
      const alt = node.getAttribute('alt') || '';
      const title = node.getAttribute('title');
      const width = node.getAttribute('width');
      const height = node.getAttribute('height');
      const alignment = node.getAttribute('data-align') || node.getAttribute('align');
      if (width || height || alignment) {
        const attributes = [
          `src="${escapeAttribute(source)}"`,
          `alt="${escapeAttribute(alt)}"`,
          title ? `title="${escapeAttribute(title)}"` : '',
          width ? `width="${escapeAttribute(width)}"` : '',
          height ? `height="${escapeAttribute(height)}"` : '',
          alignment ? `data-align="${escapeAttribute(alignment)}"` : '',
        ].filter(Boolean);
        return `\n\n<img ${attributes.join(' ')}>\n\n`;
      }
      const safeAlt = alt.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      const destination = /[\s()]/.test(source) ? `<${source}>` : source;
      const optionalTitle = title ? ` "${title.replace(/(["\\])/g, '\\$1')}"` : '';
      return `![${safeAlt}](${destination}${optionalTitle})`;
    },
  });
  service.addRule('gfmTable', {
    filter: ['table'],
    replacement: (_content, node) => {
      const rowNodes = Array.from(node.querySelectorAll('tr'));
      const rows = rowNodes.map((row) =>
        Array.from(row.querySelectorAll('th,td')).map((cell) =>
          (cell.textContent || '').trim().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'),
        ),
      );
      if (!rows.length || !rows[0].length) return '';
      const width = rows[0].length;
      const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ''));
      const format = (row: string[]) => `| ${row.join(' | ')} |`;
      const headerCells = rowNodes[0] ? Array.from(rowNodes[0].querySelectorAll('th,td')) : [];
      const separators = Array.from({ length: width }, (_, index) => {
        const cell = headerCells[index];
        const alignment = (
          cell?.getAttribute('align') ||
          (cell as HTMLElement | undefined)?.style?.textAlign ||
          ''
        ).toLowerCase();
        if (alignment === 'left') return ':---';
        if (alignment === 'right') return '---:';
        if (alignment === 'center') return ':---:';
        return '---';
      });
      return `\n\n${format(normalized[0])}\n${format(separators)}\n${normalized.slice(1).map(format).join('\n')}\n\n`;
    },
  });
  service.addRule('markoraFence', {
    filter: (node) => node.nodeName === 'PRE' && node.getAttribute('data-markora-fence') !== null,
    replacement: (_content, node) => {
      const language = node.getAttribute('data-markora-fence') || '';
      if (language === 'frontmatter') {
        const delimiter = node.getAttribute('data-markora-delimiter') || '---';
        return `\n${delimiter}\n${node.textContent?.trim() || ''}\n${delimiter}\n\n`;
      }
      if (['reference', 'footnote', 'rawhtml'].includes(language))
        return `\n\n${node.textContent?.trimEnd() || ''}\n\n`;
      if (language === 'displaymath') return `\n\n$$\n${node.textContent?.trimEnd() || ''}\n$$\n\n`;
      return `\n\n\`\`\`${language}\n${node.textContent?.trimEnd() || ''}\n\`\`\`\n\n`;
    },
  });
  service.addRule('markoraInline', {
    filter: (node) => node.nodeName === 'SPAN' && node.getAttribute('data-markora-inline') !== null,
    replacement: (_content, node) => node.textContent || '',
  });
  service.addRule('underlineAsHtml', { filter: ['u'], replacement: (content) => `<u>${content}</u>` });
  service.addRule('highlightAsHtml', {
    filter: ['mark'],
    replacement: (content) => `<mark>${content}</mark>`,
  });
  const markdown = turndownWithBoundedChunks(service, html)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return markdown ? `${markdown}\n` : '';
}

/**
 * Turndown's whitespace traversal becomes super-linear for documents with
 * thousands of sibling blocks. Structured editors expose those blocks as
 * independent top-level nodes, so large documents can be converted in bounded
 * chunks without splitting a list, table, code block, or other block subtree.
 */
function turndownWithBoundedChunks(service: TurndownService, html: string): string {
  const CHUNK_THRESHOLD = 512 * 1024;
  const CHUNK_TARGET = 64 * 1024;
  if (html.length <= CHUNK_THRESHOLD) return service.turndown(html);

  const template = document.createElement('template');
  template.innerHTML = html;
  const chunks: string[] = [];
  let pending = '';

  const flush = () => {
    if (!pending.trim()) {
      pending = '';
      return;
    }
    chunks.push(service.turndown(pending).trim());
    pending = '';
  };

  for (const node of Array.from(template.content.childNodes)) {
    const markup = node.nodeType === 1 ? (node as Element).outerHTML : node.textContent || '';
    if (pending && pending.length + markup.length > CHUNK_TARGET) flush();
    pending += markup;
    if (pending.length >= CHUNK_TARGET) flush();
  }
  flush();

  return chunks.filter(Boolean).join('\n\n');
}

export function markdownForExport(source: string): string {
  const math: string[] = [];
  const protectedSource = source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_all, expression) => {
      const token = `MARKORA_DISPLAY_MATH_${math.length}_TOKEN`;
      math.push(
        `<div class="math-block">${katex.renderToString(expression, { displayMode: true, throwOnError: false })}</div>`,
      );
      return token;
    })
    .replace(/\$([^$\n]+)\$/g, (_all, expression) => {
      const token = `MARKORA_INLINE_MATH_${math.length}_TOKEN`;
      math.push(katex.renderToString(expression, { throwOnError: false }));
      return token;
    });
  return markdownToStructuredHtml(protectedSource).replace(
    /MARKORA_(?:DISPLAY|INLINE)_MATH_(\d+)_TOKEN/g,
    (_all, index) => math[Number(index)] || '',
  );
}
