import type { PdfExportOptions } from '../../shared/contracts';
import { defaultPdfExportOptions, pdfExportOptionsSchema } from '../../shared/pdf-options';

export const PDF_PRESET_STORAGE_KEY = 'markora.pdfPresets';
export const PDF_PRESET_VERSION = 1 as const;

export interface PdfExportPreset {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly options: PdfExportOptions;
  readonly updatedAt: number;
}

interface PersistedPdfPresets {
  readonly version: typeof PDF_PRESET_VERSION;
  readonly presets: Array<Omit<PdfExportPreset, 'builtIn'>>;
}

export const builtInPdfPresets: readonly PdfExportPreset[] = [
  {
    id: 'builtin-a4-report',
    name: 'A4 report',
    builtIn: true,
    updatedAt: 0,
    options: {
      ...defaultPdfExportOptions,
      pageSize: 'A4',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      tableOfContents: true,
      header: { enabled: true, text: '{{title}}' },
      pageNumbers: true,
      printTheme: 'light',
    },
  },
  {
    id: 'builtin-letter-manuscript',
    name: 'Letter manuscript',
    builtIn: true,
    updatedAt: 0,
    options: {
      ...defaultPdfExportOptions,
      pageSize: 'Letter',
      margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
      printBackground: false,
      printTheme: 'light',
      pageNumbers: true,
    },
  },
  {
    id: 'builtin-a4-accessible',
    name: 'Accessible A4',
    builtIn: true,
    updatedAt: 0,
    options: {
      ...defaultPdfExportOptions,
      pageSize: 'A4',
      printTheme: 'light',
      generateTaggedPdf: true,
      generateDocumentOutline: true,
      tableOfContents: true,
    },
  },
];

export interface PdfPresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function presetId(name: string, now: number): string {
  const slug = name.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z\d]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `user-${slug || 'preset'}-${now.toString(36)}`;
}

function cloneOptions(options: PdfExportOptions): PdfExportOptions {
  return JSON.parse(JSON.stringify(options)) as PdfExportOptions;
}

function validatedOptions(options: unknown): PdfExportOptions {
  return pdfExportOptionsSchema.parse(options);
}

export function parsePdfPresets(raw: string | null): PdfExportPreset[] {
  if (!raw) return [];
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!input || typeof input !== 'object') return [];
  const envelope = input as Partial<PersistedPdfPresets>;
  if (envelope.version !== PDF_PRESET_VERSION || !Array.isArray(envelope.presets)) return [];
  const result: PdfExportPreset[] = [];
  for (const candidate of envelope.presets.slice(0, 100)) {
    try {
      if (
        !candidate
        || typeof candidate.id !== 'string'
        || !/^user-[a-z\d-]{1,100}$/i.test(candidate.id)
        || typeof candidate.name !== 'string'
        || !candidate.name.trim()
        || candidate.name.length > 100
        || !Number.isFinite(candidate.updatedAt)
      ) continue;
      result.push({
        id: candidate.id,
        name: candidate.name.trim(),
        builtIn: false,
        options: validatedOptions(candidate.options),
        updatedAt: candidate.updatedAt,
      });
    } catch {
      // One malformed preset must not make the remaining valid presets unavailable.
    }
  }
  return result;
}

export function serializePdfPresets(presets: readonly PdfExportPreset[]): string {
  const envelope: PersistedPdfPresets = {
    version: PDF_PRESET_VERSION,
    presets: presets
      .filter((preset) => !preset.builtIn)
      .slice(0, 100)
      .map(({ id, name, options, updatedAt }) => ({
        id,
        name,
        options: cloneOptions(validatedOptions(options)),
        updatedAt,
      })),
  };
  return JSON.stringify(envelope);
}

export class PdfPresetStore {
  constructor(private readonly storage: PdfPresetStorage) {}

  list(): PdfExportPreset[] {
    return [...builtInPdfPresets, ...parsePdfPresets(this.storage.getItem(PDF_PRESET_STORAGE_KEY))];
  }

  save(name: string, options: PdfExportOptions, now = Date.now()): PdfExportPreset {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error('Preset names must contain between 1 and 100 characters.');
    }
    const presets = parsePdfPresets(this.storage.getItem(PDF_PRESET_STORAGE_KEY));
    const sameName = presets.find((preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
    const preset: PdfExportPreset = {
      id: sameName?.id ?? presetId(normalizedName, now),
      name: normalizedName,
      builtIn: false,
      options: cloneOptions(validatedOptions(options)),
      updatedAt: now,
    };
    const next = [...presets.filter((candidate) => candidate.id !== preset.id), preset]
      .sort((left, right) => right.updatedAt - left.updatedAt);
    this.storage.setItem(PDF_PRESET_STORAGE_KEY, serializePdfPresets(next));
    return preset;
  }

  remove(id: string): boolean {
    if (builtInPdfPresets.some((preset) => preset.id === id)) return false;
    const presets = parsePdfPresets(this.storage.getItem(PDF_PRESET_STORAGE_KEY));
    const next = presets.filter((preset) => preset.id !== id);
    if (next.length === presets.length) return false;
    this.storage.setItem(PDF_PRESET_STORAGE_KEY, serializePdfPresets(next));
    return true;
  }
}
