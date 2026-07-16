import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const asset = (name: string) => path.join(process.cwd(), 'build', name);

describe('Windows application icon assets', () => {
  it('contains a valid multi-resolution ICO directory', () => {
    const bytes = fs.readFileSync(asset('icon.ico'));
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    expect(bytes.readUInt16LE(4)).toBe(7);
    const dimensions = Array.from({ length: 7 }, (_, index) => {
      const encoded = bytes[6 + index * 16];
      return encoded === 0 ? 256 : encoded;
    });
    expect(dimensions).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it('contains the 256-pixel PNG representation', () => {
    const bytes = fs.readFileSync(asset('icon-256.png'));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('keeps the editable vector source with an accessible title', () => {
    const source = fs.readFileSync(asset('icon.svg'), 'utf8');
    expect(source).toContain('<title id="title">Markora application icon</title>');
    expect(source).toContain('viewBox="0 0 512 512"');
  });
});
