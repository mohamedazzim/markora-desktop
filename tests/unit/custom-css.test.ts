import { describe, expect, it } from 'vitest';
import { sanitizeCustomCss } from '../../src/renderer/appearance/custom-css';

describe('editor custom CSS sanitizer', () => {
  it('scopes bare selectors to all safe editor roots', () => {
    const result = sanitizeCustomCss('p, h1 { color: #234; max-width: 70ch; }');
    expect(result.safe).toBe(true);
    expect(result.css).toContain('.markora-editor p');
    expect(result.css).toContain('.structured-prosemirror p');
    expect(result.css).toContain('.reading h1');
    expect(result.css).toContain('max-width: 70ch');
    expect(result.css).not.toMatch(/(^|\n)\s*p\s*\{/);
  });

  it('preserves explicit safe roots and is idempotent', () => {
    const first = sanitizeCustomCss('.structured-prosemirror blockquote { color: rebeccapurple; }');
    expect(first.safe).toBe(true);
    const second = sanitizeCustomCss(first.css);
    expect(second).toEqual(first);
  });

  it.each([
    '@import "theme.css";',
    'p { background: url(https://example.com/pixel); }',
    'p { color: javas/**/cript:alert(1); }',
    'p { width: expression(alert(1)); }',
    'p { behavior: something; }',
    'p { -moz-binding: none; }',
    '@font-face { font-family: bad; }',
  ])('rejects forbidden network or executable CSS: %s', (css) => {
    const result = sanitizeCustomCss(css);
    expect(result.safe).toBe(false);
    expect(result.css).toBe('');
    expect(result.issues[0].code).toMatch(/forbidden|unsafe|invalid/);
  });

  it.each([
    'body { color: red; }',
    ':root { color: red; }',
    '#root .toolbar { display: none; }',
    '.app { opacity: 0; }',
    '* { display: none; }',
    ':host { color: red; }',
  ])('rejects selectors outside the editor scope: %s', (css) => {
    expect(sanitizeCustomCss(css)).toMatchObject({ safe: false, css: '' });
  });

  it('rejects overlay-capable and legacy properties', () => {
    const result = sanitizeCustomCss('p { position: fixed; z-index: 99999; color: red; }');
    expect(result.safe).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('unsafe-property');
  });

  it('rejects nested rules, CSS escapes, and incomplete blocks', () => {
    expect(sanitizeCustomCss('@media screen { p { color: red; } }').safe).toBe(false);
    expect(sanitizeCustomCss('p { background: u\\72l(x); }').safe).toBe(false);
    expect(sanitizeCustomCss('p { color: red').safe).toBe(false);
  });

  it('allows bounded Markora custom properties and safe visual functions', () => {
    const result = sanitizeCustomCss(
      'blockquote { --markora-custom-tone: #456; color: color-mix(in srgb, #456 80%, white); }',
    );
    expect(result.safe).toBe(true);
    expect(result.css).toContain('--markora-custom-tone: #456');
    expect(result.css).toContain('color-mix');
  });

  it('rejects CSS over 50 KB and accepts an empty reset', () => {
    expect(sanitizeCustomCss(`p { color: red; }${' '.repeat(50_001)}`).issues[0].code).toBe('too-large');
    expect(sanitizeCustomCss('')).toEqual({ safe: true, css: '', issues: [] });
  });
});
