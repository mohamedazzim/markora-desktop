import { describe, expect, it } from 'vitest';
import {
  ASSET_DESTINATION_OPTIONS,
  findImageSyntax,
  insertImageSyntax,
  parseImageSyntax,
  replaceImageSyntax,
  serializeImage,
  validateImageOptions,
  validateImageWorkflow,
  validateRemoteImageUrl,
  type ImageOptions,
} from '../../src/renderer/images/image-utils';

const image = (overrides: Partial<ImageOptions> = {}): ImageOptions => ({
  src: 'assets/diagram.png',
  alt: 'Architecture diagram',
  preserveAspectRatio: true,
  alignment: 'default',
  ...overrides,
});

describe('image syntax parsing', () => {
  it('parses Markdown alt text, destination, and title', () => {
    const parsed = parseImageSyntax('![A \\] bracket](<assets/my image (1).png> "A \\"title\\"")');

    expect(parsed).toMatchObject({
      syntax: 'markdown',
      src: 'assets/my image (1).png',
      alt: 'A ] bracket',
      title: 'A "title"',
      preserveAspectRatio: true,
      alignment: 'default',
    });
  });

  it('parses common HTML attributes and decodes safe entities', () => {
    const parsed = parseImageSyntax(
      '<img src="assets/a&amp;b.png" alt="A &quot;quote&quot;" title=Diagram width="640px" height="360">',
    );

    expect(parsed).toMatchObject({
      syntax: 'html',
      src: 'assets/a&b.png',
      alt: 'A "quote"',
      title: 'Diagram',
      width: 640,
      height: 360,
    });
  });

  it('recovers alignment and aspect-ratio metadata from HTML', () => {
    const parsed = parseImageSyntax(
      '<img src="a.png" alt="" width="320" data-markora-preserve-aspect="true" style="display: block; margin-left: auto; margin-right: auto">',
    );

    expect(parsed).toMatchObject({
      width: 320,
      alignment: 'center',
      preserveAspectRatio: true,
    });
  });

  it('finds Markdown and HTML images in source order with exact ranges', () => {
    const source = 'before ![one](1.png) middle <img alt="two" src="2.png"> after';
    const parsed = findImageSyntax(source);

    expect(parsed.map((item) => [item.syntax, item.src])).toEqual([
      ['markdown', '1.png'],
      ['html', '2.png'],
    ]);
    expect(parsed.map((item) => source.slice(item.range.start, item.range.end))).toEqual([
      '![one](1.png)',
      '<img alt="two" src="2.png">',
    ]);
  });

  it('handles a greater-than character inside a quoted HTML attribute', () => {
    const source = '<img src="a.png" alt="A > B"> trailing';
    const parsed = findImageSyntax(source);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].alt).toBe('A > B');
    expect(parsed[0].raw).toBe('<img src="a.png" alt="A > B">');
  });

  it('requires exactly one image with no surrounding non-whitespace text', () => {
    expect(parseImageSyntax('prefix ![a](a.png)')).toBeNull();
    expect(parseImageSyntax('![a](a.png) ![b](b.png)')).toBeNull();
    expect(parseImageSyntax('<img alt="missing source">')).toBeNull();
    expect(parseImageSyntax('\n  ![a](a.png) \n')).not.toBeNull();
  });
});

describe('safe image serialization', () => {
  it('uses portable Markdown when dimensions and alignment are absent', () => {
    expect(serializeImage(image())).toBe('![Architecture diagram](assets/diagram.png)');
  });

  it('escapes Markdown text, title, and complex destinations', () => {
    expect(
      serializeImage(
        image({
          src: 'assets/my image (final).png',
          alt: 'Array [0] \\ detail',
          title: 'A "quoted" title',
        }),
      ),
    ).toBe('![Array \\[0\\] \\\\ detail](<assets/my image (final).png> "A \\"quoted\\" title")');
  });

  it('uses HTML when visual dimensions or alignment must be retained', () => {
    const output = serializeImage(image({ width: 640, alignment: 'center', title: 'Overview' }));

    expect(output).toContain('<img src="assets/diagram.png"');
    expect(output).toContain('title="Overview"');
    expect(output).toContain('width="640"');
    expect(output).toContain('data-markora-align="center"');
    expect(output).toContain('data-markora-preserve-aspect="true"');
    expect(output).toContain('height: auto');
    expect(output).toContain('margin-left: auto; margin-right: auto');
  });

  it('escapes every user-controlled HTML attribute', () => {
    const output = serializeImage(
      image({ src: 'assets/a&b.png', alt: '<diagram "one">', title: "A 'title'" }),
      'html',
    );

    expect(output).toContain('src="assets/a&amp;b.png"');
    expect(output).toContain('alt="&lt;diagram &quot;one&quot;&gt;"');
    expect(output).toContain('title="A &#39;title&#39;"');
  });

  it('never discards dimensions even when Markdown output is requested', () => {
    expect(serializeImage(image({ height: 200 }), 'markdown')).toMatch(/^<img /);
  });

  it('rejects executable and control-character sources before serialization', () => {
    expect(() => serializeImage(image({ src: 'javascript:alert(1)' }))).toThrow(/not allowed/);
    expect(() => serializeImage(image({ src: 'data:image/png;base64,AAAA' }))).toThrow(/not allowed/);
    expect(() => serializeImage(image({ src: 'a\u0000.png' }))).toThrow(/control/);
  });

  it('supports Unicode local paths without destructive normalization', () => {
    const output = serializeImage(image({ src: '圖片/प्रस्तावना image.png', alt: '日本語' }));
    expect(output).toBe('![日本語](<圖片/प्रस्तावना image.png>)');
    expect(parseImageSyntax(output)?.src).toBe('圖片/प्रस्तावना image.png');
  });
});

describe('image workflow validation', () => {
  it('accepts only complete HTTP and HTTPS remote URLs', () => {
    expect(validateRemoteImageUrl('https://example.com/image.png')).toBeNull();
    expect(validateRemoteImageUrl('http://localhost/image.png')).toBeNull();
    expect(validateRemoteImageUrl('file:///C:/image.png')).toMatch(/HTTPS or HTTP/);
    expect(validateRemoteImageUrl('image.png')).toMatch(/complete/);
  });

  it('validates finite dimensions and controlled alignment values', () => {
    const issues = validateImageOptions(
      image({ width: 0, height: Number.POSITIVE_INFINITY, alignment: 'middle' as never }),
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      'invalid-dimension',
      'invalid-dimension',
      'invalid-alignment',
    ]);
  });

  it('blocks document-relative destinations for unsaved documents', () => {
    const issues = validateImageWorkflow(
      {
        ...image(),
        sourceKind: 'file',
        destination: 'assets-directory',
      },
      { documentSaved: false, workspaceAvailable: true },
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'document-must-be-saved', field: 'destination' }),
    );
  });

  it('blocks workspace destinations without a workspace', () => {
    const issues = validateImageWorkflow(
      {
        ...image(),
        sourceKind: 'file',
        destination: 'workspace-assets-directory',
      },
      { documentSaved: true, workspaceAvailable: false },
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'workspace-required', field: 'destination' }),
    );
  });

  it('exposes every required destination strategy', () => {
    expect(ASSET_DESTINATION_OPTIONS.map((option) => option.value)).toEqual([
      'keep-original',
      'document-directory',
      'assets-directory',
      'document-assets-directory',
      'workspace-assets-directory',
      'date-directory',
    ]);
  });
});

describe('source replacement and insertion', () => {
  it('replaces exactly the parsed image while preserving surrounding source', () => {
    const source = 'Before ![old](old.png) after';
    const target = findImageSyntax(source)[0];
    const result = replaceImageSyntax(source, target, image({ src: 'new.png', alt: 'New' }));
    expect(result).toBe('Before ![New](new.png) after');
  });

  it('inserts at a canonical source offset without adding unexpected whitespace', () => {
    expect(insertImageSyntax('AB', 1, image({ src: 'x.png', alt: 'X' }))).toBe('A![X](x.png)B');
  });

  it('rejects invalid replacement and insertion ranges', () => {
    expect(() => replaceImageSyntax('abc', { start: -1, end: 1 }, image())).toThrow(RangeError);
    expect(() => insertImageSyntax('abc', 4, image())).toThrow(RangeError);
  });
});
