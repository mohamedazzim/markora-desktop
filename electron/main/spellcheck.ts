import { app, BrowserWindow, Menu, ipcMain, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SpellcheckSettings, SpellcheckStatus } from '../../src/shared/contracts';
import {
  documentSpellcheckSchema,
  normalizeSpellcheckLanguages,
  spellcheckWordSchema,
  validateSpellcheckSettings,
} from './spellcheck-policy';

const defaultSpellcheckSettings: SpellcheckSettings = {
  enabled: true,
  languages: [],
  userDictionary: [],
};
const ignoredWords = new Set<string>();

const settingsPath = () => path.join(app.getPath('userData'), 'spellcheck.json');

async function readSettings(): Promise<SpellcheckSettings> {
  try {
    return validateSpellcheckSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8')));
  } catch {
    return { ...defaultSpellcheckSettings };
  }
}

async function writeSettings(settings: SpellcheckSettings): Promise<void> {
  const target = settingsPath();
  const temp = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(temp, target);
}

function sessionFor(getWindow: () => BrowserWindow | null) {
  const window = getWindow();
  if (!window) throw new Error('The application window is not ready.');
  return window.webContents.session;
}

async function applySettings(
  getWindow: () => BrowserWindow | null,
  requested: SpellcheckSettings,
  persist: boolean,
): Promise<SpellcheckStatus> {
  const browserSession = sessionFor(getWindow);
  const availableLanguages = browserSession.availableSpellCheckerLanguages;
  const current = browserSession.getSpellCheckerLanguages();
  const settings = validateSpellcheckSettings(requested);
  const languages = normalizeSpellcheckLanguages(
    settings.languages,
    availableLanguages,
    current,
    app.getLocale(),
  );
  browserSession.spellCheckerEnabled = settings.enabled;
  if (settings.enabled && languages.length) browserSession.setSpellCheckerLanguages(languages);
  for (const word of settings.userDictionary) browserSession.addWordToSpellCheckerDictionary(word);
  const normalized = { ...settings, languages };
  if (persist) await writeSettings(normalized);
  return { ...normalized, availableLanguages };
}

export async function initializeSpellcheckWindow(window: BrowserWindow): Promise<void> {
  const settings = await readSettings();
  const getWindow = () => window;
  await applySettings(getWindow, settings, false);
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const template: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord && window.webContents.session.spellCheckerEnabled) {
      if (params.dictionarySuggestions.length) {
        template.push(
          ...params.dictionarySuggestions.slice(0, 8).map((suggestion) => ({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          })),
        );
      } else {
        template.push({ label: 'No spelling suggestions', enabled: false });
      }
      template.push(
        { type: 'separator' },
        {
          label: 'Add to dictionary',
          click: () => {
            void addPersistentWord(window, params.misspelledWord);
          },
        },
        {
          label: 'Ignore word for this session',
          click: () => {
            ignoredWords.add(params.misspelledWord);
            window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
          },
        },
        { type: 'separator' },
      );
    }
    template.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    );
    Menu.buildFromTemplate(template).popup({ window });
  });
}

async function addPersistentWord(window: BrowserWindow, candidate: string): Promise<boolean> {
  const word = spellcheckWordSchema.parse(candidate);
  const settings = await readSettings();
  const dictionary = Array.from(new Set([...settings.userDictionary, word])).sort((a, b) =>
    a.localeCompare(b),
  );
  const added = window.webContents.session.addWordToSpellCheckerDictionary(word);
  await writeSettings({ ...settings, userDictionary: dictionary });
  return added;
}

export function registerSpellcheckIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('spellcheck:get', async () => applySettings(getWindow, await readSettings(), false));
  ipcMain.handle('spellcheck:configure', async (_event, payload: unknown) => {
    return applySettings(getWindow, validateSpellcheckSettings(payload), true);
  });
  ipcMain.handle('spellcheck:document', async (_event, payload: unknown) => {
    const request = documentSpellcheckSchema.parse(payload);
    const browserSession = sessionFor(getWindow);
    browserSession.spellCheckerEnabled = request.enabled;
    if (request.enabled && request.language) {
      if (!browserSession.availableSpellCheckerLanguages.includes(request.language)) {
        throw new Error(`The spell-check language ${request.language} is not available.`);
      }
      browserSession.setSpellCheckerLanguages([request.language]);
    }
  });
  ipcMain.handle('spellcheck:add', async (_event, candidate: unknown) => {
    const window = getWindow();
    if (!window) return false;
    return addPersistentWord(window, spellcheckWordSchema.parse(candidate));
  });
  ipcMain.handle('spellcheck:ignore', (_event, candidate: unknown) => {
    const word = spellcheckWordSchema.parse(candidate);
    ignoredWords.add(word);
    return sessionFor(getWindow).addWordToSpellCheckerDictionary(word);
  });
  app.on('before-quit', () => {
    const window = getWindow();
    if (!window) return;
    for (const word of ignoredWords) window.webContents.session.removeWordFromSpellCheckerDictionary(word);
    ignoredWords.clear();
  });
}
