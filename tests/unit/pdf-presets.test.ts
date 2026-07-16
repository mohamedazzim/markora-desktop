import { describe, expect, it } from 'vitest';
import { defaultPdfExportOptions } from '../../src/shared/pdf-options';
import {
  builtInPdfPresets,
  PDF_PRESET_STORAGE_KEY,
  PdfPresetStore,
  parsePdfPresets,
  serializePdfPresets,
  type PdfPresetStorage,
} from '../../src/renderer/export/pdf-presets';

class MemoryStorage implements PdfPresetStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('PDF named presets', () => {
  it('ships immutable A4, Letter, and accessible presets', () => {
    expect(builtInPdfPresets.map((preset) => preset.name)).toEqual([
      'A4 report',
      'Letter manuscript',
      'Accessible A4',
    ]);
    expect(builtInPdfPresets.every((preset) => preset.builtIn)).toBe(true);
  });

  it('persists a validated Unicode named preset in a versioned envelope', () => {
    const storage = new MemoryStorage();
    const store = new PdfPresetStore(storage);
    const saved = store.save('लेखक की प्रति', {
      ...defaultPdfExportOptions,
      pageSize: 'A5',
      orientation: 'landscape',
    }, 123_456);

    expect(saved.id).toMatch(/^user-/);
    expect(store.list().at(-1)).toMatchObject({
      name: 'लेखक की प्रति',
      options: { pageSize: 'A5', orientation: 'landscape' },
    });
    expect(JSON.parse(storage.getItem(PDF_PRESET_STORAGE_KEY)!)).toMatchObject({ version: 1 });
  });

  it('updates a same-name user preset without creating a duplicate', () => {
    const storage = new MemoryStorage();
    const store = new PdfPresetStore(storage);
    const first = store.save('Print house', defaultPdfExportOptions, 1);
    const second = store.save('PRINT HOUSE', { ...defaultPdfExportOptions, pageSize: 'Legal' }, 2);
    expect(second.id).toBe(first.id);
    expect(store.list().filter((preset) => !preset.builtIn)).toHaveLength(1);
    expect(store.list().at(-1)?.options.pageSize).toBe('Legal');
  });

  it('removes user presets but refuses to remove built-ins', () => {
    const storage = new MemoryStorage();
    const store = new PdfPresetStore(storage);
    const user = store.save('Disposable', defaultPdfExportOptions, 1);
    expect(store.remove(builtInPdfPresets[0].id)).toBe(false);
    expect(store.remove(user.id)).toBe(true);
    expect(store.remove(user.id)).toBe(false);
  });

  it('ignores a corrupt envelope and individual invalid options', () => {
    expect(parsePdfPresets('{not json')).toEqual([]);
    expect(parsePdfPresets(JSON.stringify({ version: 99, presets: [] }))).toEqual([]);
    expect(parsePdfPresets(JSON.stringify({
      version: 1,
      presets: [{ id: 'user-bad', name: 'Bad', options: { scale: 999 }, updatedAt: 1 }],
    }))).toEqual([]);
  });

  it('never serializes built-in presets into user storage', () => {
    expect(JSON.parse(serializePdfPresets(builtInPdfPresets))).toEqual({ version: 1, presets: [] });
  });
});
