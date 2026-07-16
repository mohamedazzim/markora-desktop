import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { MarkoraApi } from '../../src/shared/contracts';
import type { ApplicationCommandId } from '../../src/shared/application-commands';

// Sandboxed Electron preloads cannot require arbitrary local CommonJS modules.
// Keep this runtime allowlist inline so the emitted preload remains self-contained.
// A parity test compares it with src/shared/application-commands.ts.
export const PRELOAD_APPLICATION_COMMAND_IDS = [
  'app.commandPalette',
  'file.new',
  'file.open',
  'file.openFolder',
  'file.save',
  'file.saveAs',
  'file.close',
  'editor.undo',
  'editor.redo',
  'editor.toggleBold',
  'editor.toggleItalic',
  'editor.toggleStrike',
  'editor.toggleUnderline',
  'editor.toggleHighlight',
  'editor.editLink',
  'editor.setParagraph',
  'editor.setHeading1',
  'editor.setHeading2',
  'editor.setHeading3',
  'editor.setHeading4',
  'editor.setHeading5',
  'editor.setHeading6',
  'editor.toggleBulletList',
  'editor.toggleOrderedList',
  'editor.toggleTaskList',
  'editor.toggleBlockquote',
  'editor.toggleCodeBlock',
  'editor.toggleSourceMode',
  'editor.insertTable',
  'editor.insertImage',
  'editor.insertMath',
  'editor.insertMermaid',
  'editor.find',
  'editor.replace',
  'table.addRowBefore',
  'table.addRowAfter',
  'table.addColumnBefore',
  'table.addColumnAfter',
  'table.deleteRow',
  'table.deleteColumn',
  'table.copyMarkdown',
  'table.copyTsv',
  'table.delete',
  'view.toggleFocusMode',
  'view.toggleTypewriterMode',
  'view.toggleZenMode',
  'view.toggleOutline',
  'view.toggleFullscreen',
  'view.toggleScrollPastEnd',
  'view.toggleWordWrap',
  'navigation.top',
  'navigation.bottom',
  'navigation.selection',
  'navigation.previousHeading',
  'navigation.nextHeading',
  'navigation.previousParagraph',
  'navigation.nextParagraph',
  'export.html',
  'export.pdf',
  'export.pandoc',
  'theme.gallery',
  'theme.white',
  'theme.clean',
  'theme.paper',
  'theme.academic',
  'theme.sepia',
  'theme.graphite',
  'theme.midnight',
  'theme.highContrast',
] as const satisfies readonly ApplicationCommandId[];

const preloadApplicationCommandIds: ReadonlySet<string> = new Set(PRELOAD_APPLICATION_COMMAND_IDS);

function isApplicationCommandId(value: unknown): value is ApplicationCommandId {
  return typeof value === 'string' && preloadApplicationCommandIds.has(value);
}

type OpenFilesCallback = (paths: string[]) => void;
const openFilesCallbacks = new Set<OpenFilesCallback>();
const pendingOpenFileBatches: string[][] = [];
type CommandCallback = (id: ApplicationCommandId) => void;
const commandCallbacks = new Set<CommandCallback>();
const pendingCommands: ApplicationCommandId[] = [];

ipcRenderer.on('app:openFiles', (_event: IpcRendererEvent, payload: unknown) => {
  if (!Array.isArray(payload)) return;
  const paths = payload.filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= 32_767 &&
      !candidate.includes('\0'),
  );
  if (paths.length === 0) return;
  if (openFilesCallbacks.size === 0) {
    pendingOpenFileBatches.push(paths);
    return;
  }
  for (const callback of openFilesCallbacks) callback(paths);
});

ipcRenderer.on('app:command', (_event: IpcRendererEvent, payload: unknown) => {
  if (!isApplicationCommandId(payload)) return;
  if (commandCallbacks.size === 0) {
    if (pendingCommands.length < 32) pendingCommands.push(payload);
    return;
  }
  for (const callback of commandCallbacks) callback(payload);
});

const api: MarkoraApi = {
  openFile: () => ipcRenderer.invoke('file:open'),
  openPath: (path) => ipcRenderer.invoke('file:openPath', path),
  onOpenFiles: (callback) => {
    openFilesCallbacks.add(callback);
    for (const paths of pendingOpenFileBatches.splice(0)) callback(paths);
    return () => openFilesCallbacks.delete(callback);
  },
  onCommand: (callback) => {
    commandCallbacks.add(callback);
    for (const id of pendingCommands.splice(0)) callback(id);
    return () => commandCallbacks.delete(callback);
  },
  saveFile: (request) => ipcRenderer.invoke('file:save', request),
  saveFileChecked: (request) => ipcRenderer.invoke('file:saveChecked', request),
  acceptDiskVersion: (request) => ipcRenderer.invoke('file:acceptDiskVersion', request),
  unwatchFile: (path) => ipcRenderer.invoke('file:unwatch', path),
  checkExternalFile: (path) => ipcRenderer.invoke('file:checkExternal', path),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  readTree: (path) => ipcRenderer.invoke('workspace:tree', path),
  previewHtmlExport: (request) => ipcRenderer.invoke('htmlExport:preview', request),
  exportHtml: (request) => ipcRenderer.invoke('htmlExport:write', request),
  pickPdfOutput: (title) => ipcRenderer.invoke('pdf:pickOutput', title),
  previewPdf: (request) => ipcRenderer.invoke('pdf:preview', request),
  exportPdf: (request) => ipcRenderer.invoke('pdf:export', request),
  cancelPdf: (operationId) => ipcRenderer.invoke('pdf:cancel', operationId),
  onPdfExportProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: unknown) =>
      callback(progress as Parameters<typeof callback>[0]);
    ipcRenderer.on('pdf:progress', listener);
    return () => ipcRenderer.removeListener('pdf:progress', listener);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listCustomThemes: () => ipcRenderer.invoke('theme:listCustom'),
  importCustomTheme: () => ipcRenderer.invoke('theme:importCustom'),
  saveCustomTheme: (theme) => ipcRenderer.invoke('theme:saveCustom', theme),
  duplicateCustomTheme: (id) => ipcRenderer.invoke('theme:duplicateCustom', id),
  deleteCustomTheme: (id) => ipcRenderer.invoke('theme:deleteCustom', id),
  exportCustomTheme: (id) => ipcRenderer.invoke('theme:exportCustom', id),
  saveRecovery: (entry) => ipcRenderer.invoke('recovery:save', entry),
  getRecoveries: () => ipcRenderer.invoke('recovery:list'),
  getRecoveryHistory: (id) => ipcRenderer.invoke('recovery:history', id),
  clearRecovery: (id) => ipcRenderer.invoke('recovery:clear', id),
  saveRecoverySession: (session) => ipcRenderer.invoke('recovery:sessionSave', session),
  loadRecoverySession: () => ipcRenderer.invoke('recovery:sessionLoad'),
  revealPath: (path) => ipcRenderer.invoke('shell:reveal', path),
  openPathExternal: (path) => ipcRenderer.invoke('shell:openPath', path),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  pickImageFile: () => ipcRenderer.invoke('image:pick'),
  importImageAsset: (request) => ipcRenderer.invoke('image:import', request),
  cancelImageOperation: (operationId) => ipcRenderer.invoke('image:cancel', operationId),
  resolveImageReference: (request) => ipcRenderer.invoke('image:resolve', request),
  copyImageToClipboard: (path) => ipcRenderer.invoke('image:copy', path),
  detectPandoc: (manualExecutable) => ipcRenderer.invoke('pandoc:detect', manualExecutable),
  pickPandocExecutable: () => ipcRenderer.invoke('pandoc:pickExecutable'),
  pickPandocInput: (format) => ipcRenderer.invoke('pandoc:pickInput', format),
  pickPandocOutput: (request) => ipcRenderer.invoke('pandoc:pickOutput', request),
  previewPandocImport: (request) => ipcRenderer.invoke('pandoc:previewImport', request),
  exportWithPandoc: (request) => ipcRenderer.invoke('pandoc:export', request),
  cancelPandoc: (operationId) => ipcRenderer.invoke('pandoc:cancel', operationId),
  onPandocProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: unknown) =>
      callback(progress as Parameters<typeof callback>[0]);
    ipcRenderer.on('pandoc:progress', listener);
    return () => ipcRenderer.removeListener('pandoc:progress', listener);
  },
  getSpellcheckStatus: () => ipcRenderer.invoke('spellcheck:get'),
  configureSpellcheck: (settings) => ipcRenderer.invoke('spellcheck:configure', settings),
  applyDocumentSpellcheck: (request) => ipcRenderer.invoke('spellcheck:document', request),
  addToDictionary: (word) => ipcRenderer.invoke('spellcheck:add', word),
  ignoreSpelling: (word) => ipcRenderer.invoke('spellcheck:ignore', word),
  searchWorkspaceAdvanced: (request) => ipcRenderer.invoke('workspace:advancedSearch', request),
  previewWorkspaceReplace: (request) => ipcRenderer.invoke('workspace:replacePreview', request),
  applyWorkspaceReplace: (request) => ipcRenderer.invoke('workspace:replaceApply', request),
  discardWorkspaceReplace: (request) => ipcRenderer.invoke('workspace:replaceDiscard', request),
  cancelWorkspaceOperation: (operationId) => ipcRenderer.invoke('workspace:operationCancel', operationId),
  onWorkspaceSearchProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: unknown) =>
      callback(progress as Parameters<typeof callback>[0]);
    ipcRenderer.on('workspace:searchProgress', listener);
    return () => ipcRenderer.removeListener('workspace:searchProgress', listener);
  },
  onExternalFileChange: (callback) => {
    const listener = (_event: IpcRendererEvent, change: unknown) =>
      callback(change as Parameters<typeof callback>[0]);
    ipcRenderer.on('file:externalChanged', listener);
    return () => ipcRenderer.removeListener('file:externalChanged', listener);
  },
  onExternalChange: (callback) => {
    const listener = (_event: IpcRendererEvent, record: unknown) =>
      callback(record as Parameters<typeof callback>[0]);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },
  isE2e: typeof ipcRenderer.sendSync === 'function' ? (ipcRenderer.sendSync('is-e2e') as boolean) : false,
};

contextBridge.exposeInMainWorld('markora', api);
