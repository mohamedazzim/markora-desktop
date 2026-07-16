export interface CustomCssIssue {
  readonly code: string;
  readonly message: string;
  readonly line?: number;
}

export interface CustomCssSanitizationResult {
  readonly safe: boolean;
  readonly css: string;
  readonly issues: readonly CustomCssIssue[];
}

const SAFE_PROPERTIES = new Set([
  'accent-color',
  'background',
  'background-color',
  'border',
  'border-block',
  'border-block-color',
  'border-block-style',
  'border-block-width',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-inline',
  'border-inline-color',
  'border-inline-start',
  'border-left',
  'border-radius',
  'border-right',
  'border-spacing',
  'border-style',
  'border-top',
  'border-width',
  'box-shadow',
  'color',
  'column-gap',
  'cursor',
  'display',
  'font',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'gap',
  'height',
  'hyphens',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-position',
  'list-style-type',
  'margin',
  'margin-block',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-inline',
  'margin-inline-end',
  'margin-inline-start',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-inline',
  'padding-inline-end',
  'padding-inline-start',
  'padding-left',
  'padding-right',
  'padding-top',
  'row-gap',
  'tab-size',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-indent',
  'text-overflow',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'vertical-align',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
]);

const SAFE_ROOTS = [
  '.document-container',
  '.markora-editor',
  '.structured-prosemirror',
  '.reading',
  '.cm-editor',
  '[data-markora-editor]',
];
const EDITOR_SCOPES = ['.markora-editor', '.structured-prosemirror', '.reading'] as const;

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalizedSecurityScan(source: string): string {
  return stripComments(source).replace(/\s+/g, '').toLowerCase();
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses -= 1;
    } else if (character === separator && parentheses === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function safeSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (/[\\@{}()]/.test(trimmed) || /^[>+~]/.test(trimmed)) return null;
  if (/(^|[\s>+~])(html|body|:root|#root|\.app|:host|:global|::part)(?=$|[\s>+~.:#[\]])/i.test(trimmed)) {
    return null;
  }
  if (trimmed === '*') return null;
  if (!/^[\w\s.#:[\]="'\->+~*]+$/u.test(trimmed)) return null;
  if (SAFE_ROOTS.some((root) => trimmed === root || trimmed.startsWith(`${root} `))) return trimmed;
  if (/^\.cm-[\w-]+/.test(trimmed)) return `.cm-editor ${trimmed}`;
  return EDITOR_SCOPES.map((root) => `${root} ${trimmed}`).join(',\n');
}

function sanitizeDeclarations(
  body: string,
  line: number,
): { declarations: string[]; issues: CustomCssIssue[] } {
  const declarations: string[] = [];
  const issues: CustomCssIssue[] = [];
  for (const rawDeclaration of splitTopLevel(body, ';')) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const colon = declaration.indexOf(':');
    if (colon <= 0) {
      issues.push({
        code: 'invalid-declaration',
        message: 'CSS declarations require a property and value.',
        line,
      });
      continue;
    }
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const customProperty = /^--markora-custom-[a-z\d-]+$/.test(property);
    if (!customProperty && !SAFE_PROPERTIES.has(property)) {
      issues.push({
        code: 'unsafe-property',
        message: `The CSS property “${property}” is not allowed in editor custom CSS.`,
        line,
      });
      continue;
    }
    if (!value || value.length > 1_000 || /[{}<>@\\]/.test(value)) {
      issues.push({ code: 'unsafe-value', message: `The value for “${property}” is not safe.`, line });
      continue;
    }
    const scan = normalizedSecurityScan(value);
    if (/(?:url\(|javascript:|expression\(|behavior:|-moz-binding)/.test(scan)) {
      issues.push({
        code: 'forbidden-css',
        message: `The value for “${property}” contains a forbidden CSS construct.`,
        line,
      });
      continue;
    }
    declarations.push(`${property}: ${value}`);
  }
  return { declarations, issues };
}

/**
 * Accepts plain declaration blocks only, prefixes them to editor roots, and
 * rejects network-capable or legacy executable CSS constructs.
 */
export function sanitizeCustomCss(source: string): CustomCssSanitizationResult {
  if (source.length > 50_000) {
    return {
      safe: false,
      css: '',
      issues: [{ code: 'too-large', message: 'Custom CSS must be 50 KB or smaller.' }],
    };
  }
  if (!source.trim()) return { safe: true, css: '', issues: [] };

  const securityScan = normalizedSecurityScan(source);
  if (
    /@import|url\(|javascript:|expression\(|behavior:|-moz-binding|@font-face|@namespace/.test(securityScan)
  ) {
    return {
      safe: false,
      css: '',
      issues: [{ code: 'forbidden-css', message: 'Custom CSS contains a forbidden rule or value.' }],
    };
  }

  const uncommented = stripComments(source);
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  const output: string[] = [];
  const issues: CustomCssIssue[] = [];
  let consumedThrough = 0;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(uncommented)) !== null) {
    if (uncommented.slice(consumedThrough, match.index).trim()) {
      issues.push({
        code: 'invalid-rule',
        message: 'Custom CSS may contain only non-nested selector blocks.',
        line: lineAt(uncommented, consumedThrough),
      });
    }
    consumedThrough = match.index + match[0].length;
    const line = lineAt(uncommented, match.index);
    const selectors = splitTopLevel(match[1], ',').map(safeSelector);
    if (selectors.some((selector) => selector === null)) {
      issues.push({
        code: 'unsafe-selector',
        message: 'A selector targets content outside the editor-safe scope.',
        line,
      });
      continue;
    }
    const declarationResult = sanitizeDeclarations(match[2], line);
    issues.push(...declarationResult.issues);
    if (declarationResult.declarations.length > 0) {
      output.push(
        `${(selectors as string[]).join(',\n')} {\n  ${declarationResult.declarations.join(';\n  ')};\n}`,
      );
    }
  }
  if (uncommented.slice(consumedThrough).trim()) {
    issues.push({
      code: 'invalid-rule',
      message: 'Custom CSS contains an incomplete or nested rule.',
      line: lineAt(uncommented, consumedThrough),
    });
  }
  if (issues.length > 0) return { safe: false, css: '', issues };
  return { safe: true, css: output.join('\n\n'), issues: [] };
}
