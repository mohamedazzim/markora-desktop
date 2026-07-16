import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { sanitizeCustomCss } from '../../src/renderer/appearance/custom-css';
import type { CustomThemePackage, CustomThemeRecord } from '../../src/shared/contracts';

const themeIdPattern = /^custom-[a-f0-9-]{36}$/u;
const color = z.string().regex(/^#[0-9a-f]{6}$/iu);
const tokenSchema = z.object({
  background: color,
  panel: color,
  surface: color,
  text: color,
  mutedText: color,
  border: color,
  accent: color,
  accentContrast: color,
  codeBackground: color,
  selection: color,
  link: color,
  blockquote: color,
  tableStripe: color,
}).strict();
const packageSchema = z.object({
  version: z.literal(1),
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400),
  author: z.string().max(120).optional(),
  light: tokenSchema,
  dark: tokenSchema,
  css: z.string().max(50_000).optional(),
}).strict();

function themesPath(): string {
  return path.join(app.getPath('userData'), 'themes');
}
function filePath(id: string, extension: '.json' | '.css' = '.json'): string {
  if (!themeIdPattern.test(id)) throw new Error('Invalid custom theme identifier.');
  return path.join(themesPath(), `${id}${extension}`);
}
function validateTheme(value: unknown): CustomThemePackage {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : value;
  // Renderer edit forms send a record that includes the read-only timestamp.
  // Strip that field before applying the strict portable-package schema.
  const input = candidate && typeof candidate === 'object' && 'updatedAt' in candidate
    ? Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'updatedAt'))
    : candidate;
  const parsed = packageSchema.parse(input) as CustomThemePackage;
  if (parsed.css) {
    const sanitized = sanitizeCustomCss(parsed.css);
    if (!sanitized.safe) throw new Error(sanitized.issues.map((issue) => issue.message).join(' '));
    parsed.css = sanitized.css;
  }
  return parsed;
}
function newId(): string {
  return `custom-${crypto.randomUUID()}`;
}
async function atomicWrite(target: string, contents: string): Promise<void> {
  await fs.mkdir(themesPath(), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'w');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
}
async function readTheme(id: string): Promise<CustomThemeRecord> {
  const source = JSON.parse(await fs.readFile(filePath(id), 'utf8')) as unknown;
  const theme = validateTheme(source);
  return { ...theme, id, updatedAt: (await fs.stat(filePath(id))).mtimeMs };
}
async function writeTheme(value: CustomThemePackage, id = value.id && themeIdPattern.test(value.id) ? value.id : newId()): Promise<CustomThemeRecord> {
  const theme = validateTheme(value);
  const record: CustomThemeRecord = { ...theme, id, updatedAt: Date.now() };
  await atomicWrite(filePath(id), `${JSON.stringify({ ...theme, id }, null, 2)}\n`);
  if (theme.css) await atomicWrite(filePath(id, '.css'), theme.css);
  else await fs.rm(filePath(id, '.css'), { force: true });
  return record;
}

export function registerThemeIpc(): void {
  ipcMain.handle('theme:listCustom', async (): Promise<CustomThemeRecord[]> => {
    try {
      const entries = await fs.readdir(themesPath(), { withFileTypes: true });
      const records: CustomThemeRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        if (!themeIdPattern.test(id)) continue;
        try { records.push(await readTheme(id)); } catch { /* corrupt themes are ignored, never executed */ }
      }
      return records.sort((a, b) => a.name.localeCompare(b.name));
    } catch (cause) {
      if ((cause as { code?: string }).code === 'ENOENT') return [];
      throw cause;
    }
  });
  ipcMain.handle('theme:saveCustom', async (_event, value: unknown) => writeTheme(validateTheme(value)));
  ipcMain.handle('theme:duplicateCustom', async (_event, candidate: unknown) => {
    const id = z.string().regex(themeIdPattern).parse(candidate);
    const source = await readTheme(id);
    return writeTheme({ ...source, id: undefined, name: `${source.name} Copy` });
  });
  ipcMain.handle('theme:deleteCustom', async (_event, candidate: unknown) => {
    const id = z.string().regex(themeIdPattern).parse(candidate);
    await fs.rm(filePath(id), { force: true });
    await fs.rm(filePath(id, '.css'), { force: true });
  });
  ipcMain.handle('theme:importCustom', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Markora theme',
      properties: ['openFile'],
      filters: [{ name: 'Markora theme', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const parsed = validateTheme(JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')));
    return writeTheme({ ...parsed, id: undefined });
  });
  ipcMain.handle('theme:exportCustom', async (_event, candidate: unknown) => {
    const id = z.string().regex(themeIdPattern).parse(candidate);
    const theme = await readTheme(id);
    const result = await dialog.showSaveDialog({
      title: 'Export Markora theme',
      defaultPath: `${theme.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'markora-theme'}.json`,
      filters: [{ name: 'Markora theme', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const exported: CustomThemePackage = { ...theme, id: undefined };
    await atomicWrite(path.resolve(result.filePath), `${JSON.stringify(exported, null, 2)}\n`);
    return true;
  });
}
