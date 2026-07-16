import { describe, expect, it } from 'vitest';
import { markdownHtml } from '../../src/renderer/main';
describe('markdown rendering', () => { it('renders GFM tables and sanitizes scripts', () => { const html = markdownHtml('| A | B |\n|---|---|\n| one | two |\n<script>alert(1)</script>'); expect(html).toContain('<table>'); expect(html).not.toContain('<script>'); }); it('renders inline and display math', () => { expect(markdownHtml('$x^2$')).toContain('katex'); expect(markdownHtml('$$x^2$$')).toContain('math-block'); }); });
