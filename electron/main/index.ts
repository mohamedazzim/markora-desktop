import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { defaultSettings, type AppSettings, type TreeEntry } from '../../src/shared/contracts';
import { registerImageIpc } from './image-ipc';
import { registerPandocIpc } from './pandoc-ipc';
import { registerPdfExportIpc } from './pdf-export-ipc';
import { registerHtmlExportIpc } from './html-export-ipc';
import { initializeSpellcheckWindow, registerSpellcheckIpc } from './spellcheck';
import {
  assertAuthorizedWorkspace,
  authorizeFile,
  authorizeWorkspace,
  isAuthorizedAsset,
  isAuthorizedFile,
} from './path-authority';
import { registerWorkspaceSearchIpc } from './workspace-search-ipc';
import { registerRecoveryIpc } from './recovery-ipc';
import { existingLaunchMarkdownPaths } from './launch-files';
import { applicationEntryUrl, isAllowedApplicationNavigation } from './navigation-policy';
import { buildApplicationMenuTemplate } from './application-menu';
import type { ApplicationCommandId } from '../../src/shared/application-commands';
import { parseAppSettings } from './app-settings-policy';
import { registerThemeIpc } from './theme-ipc';

let mainWindow: BrowserWindow | null = null;
let rendererCanReceiveEvents = false;
const pendingLaunchFiles: string[] = [];
const pendingApplicationCommands: ApplicationCommandId[] = [];
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
registerImageIpc();
registerPandocIpc(() => mainWindow);
registerPdfExportIpc(() => mainWindow);
registerHtmlExportIpc();
registerSpellcheckIpc(() => mainWindow);
registerWorkspaceSearchIpc(() => mainWindow);
registerRecoveryIpc({ getWindow: () => mainWindow });
registerThemeIpc();
const readSettings = async (): Promise<AppSettings> => {
  try {
    return parseAppSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8')));
  } catch {
    return defaultSettings;
  }
};
const writeSettings = async (settings: AppSettings) => {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
};
const tree = async (root: string, depth = 0): Promise<TreeEntry[]> => {
  // Do not truncate normal workspaces; expansion is lazy in the renderer and
  // this guard only protects against pathological directory nesting.
  if (depth > 64) return [];
  const items = await fs.readdir(root, { withFileTypes: true });
  return Promise.all(
    items
      .filter((item) => !['node_modules', '.git'].includes(item.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(async (item) => {
        const itemPath = path.join(root, item.name);
        if (item.isDirectory()) {
          // Keep empty folders visible, but return an empty children list so the
          // renderer can omit an expand affordance for folders with nothing inside.
          return {
            name: item.name,
            path: itemPath,
            type: 'folder',
            children: await tree(itemPath, depth + 1),
          };
        }
        const stat = await fs.stat(itemPath);
        return { name: item.name, path: itemPath, type: 'file', modifiedAt: stat.mtimeMs };
      }),
  );
};
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function deliverLaunchFiles(paths: readonly string[]): void {
  if (paths.length === 0) return;
  const unique = Array.from(new Set(paths.map(authorizeFile)));
  if (rendererCanReceiveEvents && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:openFiles', unique);
    focusMainWindow();
    return;
  }
  for (const filePath of unique) {
    if (!pendingLaunchFiles.includes(filePath)) pendingLaunchFiles.push(filePath);
  }
}

function deliverApplicationCommand(id: ApplicationCommandId): void {
  if (rendererCanReceiveEvents && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:command', id);
    return;
  }
  if (pendingApplicationCommands.length < 32) pendingApplicationCommands.push(id);
}

async function receiveLaunchArguments(argv: readonly string[], workingDirectory: string): Promise<void> {
  const paths = await existingLaunchMarkdownPaths(argv, {
    isPackaged: app.isPackaged,
    workingDirectory: workingDirectory || process.cwd(),
  });
  deliverLaunchFiles(paths);
}

function createWindow() {
  rendererCanReceiveEvents = false;
  const entryUrl = applicationEntryUrl(app.isPackaged, __dirname);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#111827',
    icon: app.isPackaged ? undefined : path.join(process.cwd(), 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      additionalArguments: process.env.MARKORA_E2E === '1' ? ['--markora-e2e'] : [],
    },
  });
  void initializeSpellcheckWindow(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedApplicationNavigation(url, entryUrl)) event.preventDefault();
  });
  mainWindow.webContents.on('did-start-loading', () => {
    rendererCanReceiveEvents = false;
  });
  mainWindow.webContents.on('did-finish-load', () => {
    rendererCanReceiveEvents = true;
    if (pendingLaunchFiles.length > 0) {
      const files = pendingLaunchFiles.splice(0);
      mainWindow?.webContents.send('app:openFiles', files);
    }
    for (const id of pendingApplicationCommands.splice(0)) {
      mainWindow?.webContents.send('app:command', id);
    }
  });
  mainWindow.once('closed', () => {
    rendererCanReceiveEvents = false;
    mainWindow = null;
  });
  void mainWindow.loadURL(entryUrl);
}

function installApplicationMenu(): void {
  const template = buildApplicationMenuTemplate({
    isPackaged: app.isPackaged,
    dispatchCommand: deliverApplicationCommand,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    void receiveLaunchArguments(commandLine, workingDirectory).finally(focusMainWindow);
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void receiveLaunchArguments([process.execPath, filePath], process.cwd());
  });
  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.markora.desktop');
    await receiveLaunchArguments(process.argv, process.cwd());
    createWindow();
    installApplicationMenu();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
ipcMain.handle('workspace:open', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  const workspace = authorizeWorkspace(result.filePaths[0]);
  return { path: workspace, tree: await tree(workspace) };
});
ipcMain.handle('workspace:tree', async (_e, candidate: unknown) => {
  const root = z.string().min(1).max(32_767).parse(candidate);
  assertAuthorizedWorkspace(root);
  return tree(root);
});
ipcMain.handle('settings:get', readSettings);
ipcMain.handle('settings:save', async (_e, value: unknown) => writeSettings(parseAppSettings(value)));
ipcMain.handle('shell:reveal', async (_e, candidate: unknown) => {
  const item = z.string().min(1).max(32_767).parse(candidate);
  if (!isAuthorizedFile(item) && !isAuthorizedAsset(item)) throw new Error('The path is not authorized.');
  shell.showItemInFolder(item);
});
ipcMain.handle('shell:external', async (_e, candidate: unknown) => {
  try {
    const url = z.string().min(1).max(8_192).parse(candidate);
    const parsed = new URL(url);
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return false;
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

ipcMain.on('is-e2e', (event) => {
  event.returnValue = process.env.MARKORA_E2E === '1';
});
