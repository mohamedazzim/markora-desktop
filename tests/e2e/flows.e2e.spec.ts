import axe, { type AxeResults } from 'axe-core';
import type { Locator } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  expect,
  installDialogPlan,
  launchElectronWithUserData,
  replaceSourceDocument,
  replaceStructuredDocument,
  sourceDocumentText,
  test,
  type MarkoraElectronFixture,
} from './electron-fixture';

const alphaPath = (temporaryDirectory: string) => path.join(temporaryDirectory, 'workspace', 'alpha.md');
const pixelPath = (temporaryDirectory: string) => path.join(temporaryDirectory, 'pixel.png');

const documentTabs = (markora: MarkoraElectronFixture) =>
  markora.page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

const sidebarTab = (markora: MarkoraElectronFixture, name: string) =>
  markora.page.getByRole('tablist', { name: 'Sidebar panels' }).getByRole('tab', { name });

async function runAxeInElectron(markora: MarkoraElectronFixture, selector: string): Promise<AxeResults> {
  // AxeBuilder finishes in context.newPage(), which Electron's BrowserWindow
  // context does not support. Run axe inside the actual renderer instead.
  // Runtime evaluation uses Playwright's automation world without modifying the
  // application's production script-src policy.
  await markora.page.evaluate(axe.source);
  return markora.page.evaluate(async (contextSelector) => {
    const axeApi = (
      window as typeof window & {
        axe: { run: (context: unknown, options: unknown) => Promise<AxeResults> };
      }
    ).axe;
    return axeApi.run(
      { include: [contextSelector], exclude: ['.test-utility-buttons'] },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
      },
    );
  }, selector);
}

async function forwardThroughSecondElectronInstance(
  markora: MarkoraElectronFixture,
  markdownPath: string,
): Promise<{ readonly exitCode: number | null; readonly stderr: string }> {
  const projectDirectory = path.resolve(__dirname, '../..');
  const executable = path.join(
    projectDirectory,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );
  const environment: Record<string, string | undefined> = { ...process.env, MARKORA_E2E: '1' };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [`--user-data-dir=${markora.userDataDirectory}`, projectDirectory, markdownPath],
    {
      cwd: projectDirectory,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('The secondary Electron process did not exit after forwarding its file.'));
    }, 15_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stderr });
    });
  });
}

async function openWorkspace(markora: MarkoraElectronFixture) {
  await installDialogPlan(markora.app, { workspaceDirectory: markora.workspaceDirectory });
  await markora.page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(markora.page.getByTitle(markora.workspaceDirectory, { exact: true })).toContainText(
    'workspace',
  );
}

async function searchWorkspace(markora: MarkoraElectronFixture, query = 'workspace needle') {
  await openWorkspace(markora);
  await sidebarTab(markora, 'Workspace search').click();
  const searchPanel = markora.page.getByRole('tabpanel', { name: 'Workspace search' });
  await searchPanel.getByLabel('Search workspace').fill(query);
  await searchPanel.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(searchPanel.getByText(/2 matches in 2 files/).first()).toBeVisible();
}

async function saveCurrentDocument(markora: MarkoraElectronFixture, fileName = 'saved.md'): Promise<string> {
  const destination = path.join(markora.temporaryDirectory, fileName);
  await installDialogPlan(markora.app, { saveByExtension: { md: destination } });
  await markora.page.getByLabel('Save file').click();
  await expect.poll(async () => fs.readFile(destination, 'utf8').catch(() => '')).not.toBe('');
  return destination;
}

async function writeExternalFile(filePath: string, contents: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.writeFile(filePath, contents, 'utf8');
      return;
    } catch (error) {
      const code = (error as { readonly code?: string }).code;
      if (!['EBUSY', 'EPERM'].includes(code ?? '') || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function dispatchPngFileEvent(locator: Locator, kind: 'paste' | 'drop') {
  await locator.evaluate((element, eventKind) => {
    const bytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8V8AAAAASUVORK5CYII='),
      (character) => character.charCodeAt(0),
    );
    const file = new File([bytes], 'clipboard-pixel.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event =
      eventKind === 'paste'
        ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
        : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    element.dispatchEvent(event);
  }, kind);
}

test('creates a new document tab through the central file command', async ({ markora }) => {
  await expect(documentTabs(markora)).toHaveCount(1);
  await markora.page.getByLabel('New document').click();
  await expect(documentTabs(markora)).toHaveCount(2);
  await expect(documentTabs(markora).last()).toHaveAttribute('aria-selected', 'true');
});

test('closes document tabs in bulk from the tab context menu', async ({ markora }) => {
  await markora.page.getByLabel('New document').click();
  await markora.page.getByLabel('New document').click();
  const tabs = documentTabs(markora);
  await expect(tabs).toHaveCount(3);
  await tabs.nth(1).click({ button: 'right' });
  const menu = markora.page.getByRole('menu', { name: /Actions for/ });
  await expect(menu.getByRole('menuitem', { name: 'Close All to the Right' })).toBeVisible();
  markora.page.once('dialog', (dialog) => void dialog.accept());
  await menu.getByRole('menuitem', { name: 'Close All to the Right' }).click();
  await expect(tabs).toHaveCount(2);
  await tabs.first().click({ button: 'right' });
  markora.page.once('dialog', (dialog) => void dialog.accept());
  await markora.page.getByRole('menuitem', { name: 'Close Others' }).click();
  await expect(tabs).toHaveCount(1);
  await markora.page.getByLabel('New document').click();
  await markora.page.getByLabel('New document').click();
  await tabs.first().click({ button: 'right' });
  markora.page.once('dialog', (dialog) => void dialog.accept());
  await markora.page.getByRole('menuitem', { name: 'Close All', exact: true }).click();
  await expect(tabs).toHaveCount(1);
});

test('opens workspaces collapsed, lists unsupported files, and expands on demand', async ({ markora }) => {
  await openWorkspace(markora);
  const nested = markora.page.getByRole('treeitem', { name: /nested/ }).first();
  await expect(nested).toHaveAttribute('aria-expanded', 'false');
  await expect(markora.page.getByRole('button', { name: 'beta.markdown' })).toHaveCount(0);
  await expect(markora.page.getByRole('button', { name: 'ignored.txt' })).toBeVisible();
  await nested.getByRole('button', { name: /Expand folder nested/ }).click();
  await expect(markora.page.getByRole('button', { name: 'beta.markdown' })).toBeVisible();
});

test('opens a relative Markdown source link from the structured editor', async ({ markora }) => {
  await openWorkspace(markora);
  await replaceSourceDocument(markora.page, '[Beta document](nested/beta.markdown)');
  await markora.page.getByRole('button', { name: 'Structured', exact: true }).click();
  await markora.page.locator('.structured-prosemirror a').click();
  await expect(documentTabs(markora).filter({ hasText: 'beta.markdown' })).toBeVisible();
});

test('opens encoded document links and navigates to another document heading', async ({ markora }) => {
  await openWorkspace(markora);
  await replaceSourceDocument(
    markora.page,
    '[Architecture](ARCHITECTURE_DIAGRAMS.md#Dataset%20split%20methodology) and [encoded](My%20Document.md)',
  );
  await markora.page.getByRole('button', { name: 'Structured', exact: true }).click();
  const links = markora.page.locator('.structured-prosemirror a');
  await links.first().click();
  await expect(documentTabs(markora).filter({ hasText: 'ARCHITECTURE_DIAGRAMS.md' })).toBeVisible();
  await expect(markora.page.getByText(/Opened ARCHITECTURE_DIAGRAMS\.md at heading/)).toBeVisible();
  await documentTabs(markora).first().click();
  await links.last().click();
  await expect(documentTabs(markora).filter({ hasText: 'My Document.md' })).toBeVisible();
});

test('edits a document in Structured Mode', async ({ markora }) => {
  await replaceStructuredDocument(markora.page, 'Structured mode writes real document state.');
  await expect(markora.page.getByLabel('Structured Markdown editor')).toContainText(
    'Structured mode writes real document state.',
  );
  await expect(markora.page.getByRole('tab', { name: /Untitled\.md/ })).toContainText('Untitled.md');
});

test('switches from Structured Mode to Source Mode', async ({ markora }) => {
  await markora.page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(markora.page.getByLabel('Markdown source editor')).toBeVisible();
  await expect(markora.page.getByText('Markdown source', { exact: true })).toBeVisible();
});

test('round-trips structured and source edits without losing semantics', async ({ markora }) => {
  await replaceStructuredDocument(markora.page, 'Structured journey text');
  await replaceSourceDocument(markora.page, '# Journey\n\nStructured journey text\n\nSource journey text');
  await markora.page.getByRole('button', { name: 'Structured', exact: true }).click();
  await expect(markora.page.getByRole('heading', { name: 'Journey' })).toBeVisible();
  await expect(markora.page.getByLabel('Structured Markdown editor')).toContainText('Source journey text');
  expect(await sourceDocumentText(markora.page)).toContain('Source journey text');
});

test('saves an unsaved document through the native dialog and atomic file IPC', async ({ markora }) => {
  await replaceSourceDocument(markora.page, '# Saved through Electron\n\nPersistent text.');
  const destination = await saveCurrentDocument(markora, 'atomic-save.md');
  await expect(markora.page.getByRole('tab', { name: 'atomic-save.md' })).toBeVisible();
  expect(await fs.readFile(destination, 'utf8')).toContain('Saved through Electron');
});

test('closes and reopens a Markdown file through native open IPC', async ({ markora }) => {
  const filePath = alphaPath(markora.temporaryDirectory);
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await markora.page.getByLabel('Open file').click();
  const alphaTab = documentTabs(markora).filter({ hasText: 'alpha.md' });
  await expect(alphaTab).toBeVisible();
  await alphaTab.press('Delete');
  await expect(alphaTab).toHaveCount(0);
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await markora.page.getByLabel('Open file').click();
  await expect(markora.page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
});

test('inserts a GFM table in the real Structured editor', async ({ markora }) => {
  await markora.page.getByRole('button', { name: 'Table', exact: true }).click();
  const dialog = markora.page.getByRole('dialog', { name: 'Insert table' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Rows').fill('3');
  await dialog.getByLabel('Columns').fill('3');
  await dialog.getByRole('button', { name: 'Insert table' }).click();
  await expect(markora.page.locator('.structured-prosemirror table')).toBeVisible();
  await expect(markora.page.locator('.structured-prosemirror tr')).toHaveCount(3);
});

test('modifies a visual table with table editing controls', async ({ markora }) => {
  await markora.page.getByRole('button', { name: 'Table', exact: true }).click();
  const dialog = markora.page.getByRole('dialog', { name: 'Insert table' });
  await dialog.getByLabel('Rows').fill('3');
  await dialog.getByLabel('Columns').fill('2');
  await dialog.getByRole('button', { name: 'Insert table' }).click();
  const firstCell = markora.page.locator('.structured-prosemirror th').first();
  await firstCell.click();
  await markora.page.keyboard.insertText('Edited heading');
  await expect(firstCell).toContainText('Edited heading');
  // Re-click cell to ensure ProseMirror selection is in the table and toolbar renders
  await firstCell.click();
  const toolbar = markora.page.getByLabel('Table tools');
  await expect(toolbar).toBeVisible({ timeout: 5000 });
  // Use evaluate to click the button directly — Playwright's click() hangs because
  // the button handler triggers a ProseMirror transaction that re-renders the toolbar
  // between mousedown and mouseup.
  await markora.page.evaluate(() => {
    const toolbar = document.querySelector('[aria-label="Table tools"]');
    const buttons = toolbar?.querySelectorAll('button');
    const rowDownBtn = Array.from(buttons ?? []).find((b) => b.textContent?.trim() === 'Row Down');
    rowDownBtn?.click();
  });
  await expect(markora.page.locator('.structured-prosemirror tr')).toHaveCount(4);
});

test('inserts and renders a KaTeX math fence', async ({ markora }) => {
  await markora.page.getByRole('button', { name: 'Math', exact: true }).click();
  await expect(markora.page.getByRole('img', { name: 'math preview' }).first()).toBeVisible();
  await expect(markora.page.locator('.fence-node.math .katex').first()).toBeVisible();
  expect(await sourceDocumentText(markora.page)).toContain('E = mc^2');
});

test('inserts and renders a Mermaid diagram with the Structured editor', async ({ markora }) => {
  await markora.page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await expect(markora.page.getByRole('img', { name: 'mermaid preview' }).first()).toBeVisible();
  await expect(markora.page.locator('.fence-node.mermaid svg').first()).toBeVisible({ timeout: 20_000 });
  expect(await sourceDocumentText(markora.page)).toContain('flowchart LR');
});

test('renders Mermaid fences loaded from an existing Markdown file', async ({ markora }) => {
  const filePath = path.join(markora.temporaryDirectory, 'diagram.md');
  await fs.writeFile(filePath, '```mermaid\nflowchart LR\n  A --> B\n```\n', 'utf8');
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await markora.page.getByLabel('Open file').click();
  await expect(markora.page.locator('.fence-node.mermaid svg').first()).toBeVisible({ timeout: 20_000 });
});

test('inserts a local image selected through a native file picker', async ({ markora }) => {
  await replaceSourceDocument(markora.page, '# Image document');
  await saveCurrentDocument(markora, 'image-document.md');
  await markora.page.getByRole('button', { name: 'Structured', exact: true }).click();
  await installDialogPlan(markora.app, { imageFiles: [pixelPath(markora.temporaryDirectory)] });
  await markora.page.getByTitle('Insert or edit image').click();
  await expect(markora.page.getByRole('dialog', { name: 'Insert image' })).toBeVisible();
  await markora.page.getByRole('button', { name: /Browse/ }).click();
  await markora.page.getByRole('button', { name: 'Insert image', exact: true }).click();
  await expect(markora.page.locator('.structured-prosemirror img')).toHaveAttribute('alt', 'pixel');
  await expect
    .poll(async () =>
      fs.access(path.join(markora.temporaryDirectory, 'assets', 'pixel.png')).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
});

test('pastes a clipboard image into Source Mode and copies it into assets', async ({ markora }) => {
  const destination = path.join(markora.temporaryDirectory, 'pasted-image.md');
  await installDialogPlan(markora.app, { saveByExtension: { md: destination } });
  await markora.page.getByRole('button', { name: 'Source', exact: true }).click();
  await dispatchPngFileEvent(markora.page.locator('.source'), 'paste');
  await expect(markora.page.getByLabel('Markdown source editor')).toContainText('clipboard-pixel');
  await expect
    .poll(async () =>
      fs.access(path.join(markora.temporaryDirectory, 'assets', 'clipboard-pixel.png')).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
});

test('drops a File Explorer image into Source Mode and copies it into assets', async ({ markora }) => {
  const destination = path.join(markora.temporaryDirectory, 'dropped-image.md');
  await installDialogPlan(markora.app, { saveByExtension: { md: destination } });
  await markora.page.getByRole('button', { name: 'Source', exact: true }).click();
  await dispatchPngFileEvent(markora.page.locator('.source'), 'drop');
  await expect(markora.page.getByLabel('Markdown source editor')).toContainText('clipboard-pixel');
  await expect
    .poll(async () =>
      fs.access(path.join(markora.temporaryDirectory, 'assets', 'clipboard-pixel.png')).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
});

test('opens a workspace through the native directory picker', async ({ markora }) => {
  await openWorkspace(markora);
  const workspaceTree = markora.page.getByRole('tree', { name: 'Workspace files' });
  await expect(workspaceTree).toBeVisible();
  await expect(markora.page.getByRole('button', { name: 'alpha.md' })).toBeVisible();
  await expect(markora.page.getByText('nested')).toBeVisible();
  await expect(workspaceTree.locator('[data-tree-row] svg')).not.toHaveCount(0);
  await expect(workspaceTree).not.toContainText(/^\s*[>v]\s+/m);
});

test('searches workspace content in the background worker and opens an exact result', async ({ markora }) => {
  await searchWorkspace(markora);
  const result = markora.page.getByRole('button', { name: /Open alpha\.md at line 3, column 1/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(markora.page.getByRole('tab', { name: 'alpha.md' })).toBeVisible();
  await expect(markora.page.getByLabel('Markdown source editor')).toBeVisible();
});

test('previews, confirms, backs up, and applies selected workspace replacements', async ({ markora }) => {
  await searchWorkspace(markora);
  await markora.page.getByLabel('Replace with').fill('replacement complete');
  await markora.page.getByRole('button', { name: 'Preview selected replacements' }).click();
  await expect(markora.page.getByRole('region', { name: 'Workspace replacement preview' })).toContainText(
    '2 replacements in 2 files',
  );
  await markora.page.getByRole('button', { name: /Apply preview/ }).click();
  await expect(
    markora.page.getByRole('alertdialog', { name: 'Confirm workspace replacement' }),
  ).toBeVisible();
  await markora.page.getByRole('button', { name: 'Confirm, back up, and replace' }).click();
  await expect(markora.page.getByRole('region', { name: 'Workspace replacement result' })).toContainText(
    'Replaced 2 matches in 2 files',
  );
  expect(await fs.readFile(alphaPath(markora.temporaryDirectory), 'utf8')).toContain('replacement complete');
  expect(
    await fs.readFile(path.join(markora.workspaceDirectory, 'nested', 'beta.markdown'), 'utf8'),
  ).toContain('replacement complete');
});

test('opens and executes a command with keyboard navigation in the command palette', async ({ markora }) => {
  await markora.page.locator('body').click({ position: { x: 0, y: 0 } });
  await markora.page.keyboard.press('Control+Shift+P');
  const palette = markora.page.getByRole('dialog', { name: 'Command Palette' });
  await expect(palette).toBeVisible();
  await markora.page.getByLabel('Search commands').fill('toggle focus mode');
  await markora.page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(markora.page.locator('main.app')).toHaveClass(/markora-focus-mode/);
});

test('records, persists, and dispatches a configurable shortcut', async ({ markora }) => {
  await sidebarTab(markora, 'Settings').click();
  const settingsPanel = markora.page.getByRole('tabpanel', { name: 'Settings' });
  await settingsPanel.getByLabel('Search commands').fill('Toggle Focus Mode');
  const record = settingsPanel.getByRole('button', {
    name: 'Record shortcut for Toggle Focus Mode',
  });
  await record.click();
  await markora.page.keyboard.press('Control+Alt+G');
  await expect(markora.page.getByLabel('Current shortcut: Ctrl+Alt+G')).toBeVisible({ timeout: 5_000 });
  await markora.page.keyboard.press('Control+Alt+G');
  await expect(markora.page.locator('main.app')).toHaveClass(/markora-focus-mode/);
});

test('toggles Focus Mode with its default application shortcut', async ({ markora }) => {
  await markora.page.locator('body').click({ position: { x: 0, y: 0 } });
  await markora.page.keyboard.press('Control+Alt+F');
  await expect(markora.page.locator('main.app')).toHaveClass(/markora-focus-mode/);
  await expect(markora.page.locator('.structured-prosemirror [data-markora-active="true"]')).toBeVisible();
});

test('toggles Typewriter Mode and keeps the active editor operational', async ({ markora }) => {
  await markora.page.locator('body').click({ position: { x: 0, y: 0 } });
  await markora.page.keyboard.press('Control+Alt+T');
  await expect(markora.page.locator('main.app')).toHaveClass(/markora-typewriter-mode/);
  await replaceStructuredDocument(markora.page, 'Centered active writing block');
  await expect(markora.page.getByLabel('Structured Markdown editor')).toContainText(
    'Centered active writing block',
  );
});

test('toggles Zen Mode with a multi-key chord and hides configured regions', async ({ markora }) => {
  await markora.page.locator('body').click({ position: { x: 0, y: 0 } });
  await markora.page.keyboard.press('Control+K');
  await expect(markora.page.locator('.chord-status')).toContainText('Waiting for chord');
  await markora.page.keyboard.press('Z');
  await expect(markora.page.locator('main.app')).toHaveClass(/markora-zen-mode/);
  await expect(markora.page.locator('[data-markora-region="toolbar"]')).toBeHidden();
  await expect(markora.page.locator('[data-markora-region="tabBar"]')).toBeHidden();
});

test('changes and persists a built-in dark theme through appearance settings', async ({ markora }) => {
  await sidebarTab(markora, 'Settings').click();
  await markora.page
    .getByRole('tabpanel', { name: 'Settings' })
    .getByRole('button', { name: /Appearance and writing modes/ })
    .click();
  const dialog = markora.page.getByRole('dialog', { name: 'Appearance and writing modes' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Color mode').selectOption('dark');
  await dialog.getByLabel('Midnight').check();
  await expect(markora.page.locator('main.app')).toHaveClass(/dark/);
  await markora.page.getByLabel('Close appearance settings').click();
  await expect
    .poll(() => markora.page.evaluate(() => localStorage.getItem('markora.appearance')))
    .toContain('midnight');
});

test('navigates the Theme Gallery and imports a custom theme', async ({ markora }) => {
  const themePath = path.join(markora.temporaryDirectory, 'ocean-mist.json');
  const tokens = {
    background: '#071923',
    panel: '#0d2838',
    surface: '#102f42',
    text: '#e4f4ff',
    mutedText: '#9fc1d4',
    border: '#2c5368',
    accent: '#55c2e8',
    accentContrast: '#06202e',
    codeBackground: '#0b2230',
    selection: '#1f5a74',
    link: '#7ddcff',
    blockquote: '#9fc1d4',
    tableStripe: '#12384d',
  };
  await fs.writeFile(
    themePath,
    JSON.stringify({
      version: 1,
      name: 'Ocean Mist',
      description: 'A calm blue writing surface.',
      light: tokens,
      dark: tokens,
      css: '.document-container { letter-spacing: 0.01em; }',
    }),
    'utf8',
  );
  await installDialogPlan(markora.app, { themeFiles: [themePath] });

  await sidebarTab(markora, 'Settings').click();
  await markora.page
    .getByRole('tabpanel', { name: 'Settings' })
    .getByRole('button', { name: /Appearance and writing modes/ })
    .click();
  const dialog = markora.page.getByRole('dialog', { name: 'Appearance and writing modes' });
  await expect(dialog.getByRole('heading', { name: 'Theme gallery' })).toBeVisible();
  await dialog.getByRole('button', { name: /Import custom theme/ }).click();
  await expect(dialog.getByRole('button', { name: /Ocean Mist/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Document', exact: true }).click();
  await dialog.getByRole('button', { name: /Ocean Mist/ }).click();
  await expect
    .poll(() => markora.page.evaluate(() => localStorage.getItem('markora.appearance')))
    .toContain('custom-');
  await expect(dialog.getByRole('button', { name: /Ocean Mist/ })).toBeVisible();
});

test('previews and exports standalone HTML through the real export IPC', async ({ markora }) => {
  await replaceSourceDocument(markora.page, '# HTML export\n\nA **rendered** document.');
  const destination = path.join(markora.temporaryDirectory, 'document.html');
  await installDialogPlan(markora.app, { saveByExtension: { html: destination } });
  await markora.page.getByTitle('Export rendered HTML').click();
  const dialog = markora.page.getByRole('dialog', { name: 'Export HTML' });
  await dialog.getByRole('button', { name: 'Generate preview' }).click();
  await expect(dialog.getByTitle('HTML export preview')).toBeVisible();
  await dialog.getByRole('button', { name: /Export HTML/ }).click();
  await expect(dialog).toContainText(destination);
  const html = await fs.readFile(destination, 'utf8');
  expect(html).toContain('<strong>rendered</strong>');
  expect(html).toContain('charset="utf-8"');
});

test('previews and exports PDF through Chromium printToPDF', async ({ markora }) => {
  await replaceSourceDocument(
    markora.page,
    '# PDF export\n\nUnicode नमस्ते 🌍\n\n| A | B |\n|---|---|\n| 1 | 2 |',
  );
  const destination = path.join(markora.temporaryDirectory, 'document.pdf');
  await installDialogPlan(markora.app, { saveByExtension: { pdf: destination } });
  await markora.page.getByTitle('Export PDF').click();
  const dialog = markora.page.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog.getByTitle('PDF preview')).toBeVisible();
  await dialog.getByRole('button', { name: /Export PDF/ }).click();
  await expect(dialog).toContainText(/Saved .* pages/, { timeout: 30_000 });
  const bytes = await fs.readFile(destination);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.byteLength).toBeGreaterThan(1_000);
});

test('creates an autosave snapshot and recovers it after renderer restart', async ({ markora }) => {
  await markora.page.getByRole('tab', { name: 'Settings' }).click();
  await markora.page.getByLabel('Autosave seconds').fill('5');
  await replaceSourceDocument(markora.page, '# Recovery proof\n\nUnsaved recovery content.');
  const recoveryDirectory = path.join(markora.userDataDirectory, 'recovery');
  await expect
    .poll(
      async () => {
        const documents = await fs.readdir(path.join(recoveryDirectory, 'documents')).catch(() => []);
        const latest = await Promise.all(
          documents.map(async (documentId) => {
            const content = await fs
              .readFile(path.join(recoveryDirectory, 'documents', documentId, 'latest.json'), 'utf8')
              .catch(() => '');
            if (!content) return false;
            return (JSON.parse(content) as { reason?: string }).reason === 'autosave';
          }),
        );
        return latest.some(Boolean);
      },
      { timeout: 12_000 },
    )
    .toBe(true);
  await markora.page.reload();
  const recovery = markora.page.getByRole('dialog', { name: 'Restore previous session' });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText(/Unsaved (?:autosave|shutdown) snapshot/);
  await recovery.getByRole('button', { name: 'Restore selected' }).click();
  await expect(recovery).toBeHidden();
  await expect(markora.page.getByRole('tab', { name: /Untitled\.md/ })).toBeVisible();
  expect(await sourceDocumentText(markora.page)).toContain('Unsaved recovery content');
});

test('detects an external file modification and reloads the clean editor version', async ({ markora }) => {
  const filePath = alphaPath(markora.temporaryDirectory);
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await markora.page.getByLabel('Open file').click();
  await replaceSourceDocument(markora.page, '# Alpha\n\nSaved baseline');
  await markora.page.getByLabel('Save file').click();
  await writeExternalFile(filePath, '# Alpha changed externally\n\nDisk is newer.\n');
  const conflict = markora.page.getByRole('dialog', { name: 'Resolve disk conflict' });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await conflict.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(conflict).toBeHidden();
  await expect(markora.page.getByLabel('Markdown source editor')).toContainText('Disk is newer', {
    timeout: 15_000,
  });
});

test('keeps unsaved editor text when an external file change conflicts', async ({ markora }) => {
  const filePath = alphaPath(markora.temporaryDirectory);
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await markora.page.getByLabel('Open file').click();
  await replaceSourceDocument(markora.page, '# Alpha\n\nSaved baseline');
  await markora.page.getByLabel('Save file').click();
  await replaceSourceDocument(markora.page, '# Alpha\n\nUnsaved editor wins for now');
  await writeExternalFile(filePath, '# Alpha\n\nConflicting disk text.\n');
  const conflict = markora.page.getByRole('dialog', { name: 'Resolve disk conflict' });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await conflict.getByRole('button', { name: 'Compare' }).click();
  await expect(conflict.getByRole('region', { name: 'Editor and disk comparison' })).toContainText(
    'Conflicting disk text',
  );
  await conflict.getByRole('button', { name: 'Keep editor version' }).click();
  await expect(conflict).toBeHidden();
  await expect(markora.page.getByLabel('Markdown source editor')).toContainText(
    'Unsaved editor wins for now',
  );
});

test('relaunches and restores the prior document session', async ({ markora }) => {
  const filePath = alphaPath(markora.temporaryDirectory);
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await markora.page.getByLabel('Open file').click();
  const sessionPath = path.join(markora.userDataDirectory, 'recovery', 'session.json');
  await expect
    .poll(
      async () =>
        fs.readFile(sessionPath, 'utf8').then(
          (content) => content.includes('alpha.md'),
          () => false,
        ),
      { timeout: 12_000 },
    )
    .toBe(true);
  await markora.app.close();
  const relaunched = await launchElectronWithUserData(markora.userDataDirectory);
  const recovery = relaunched.page.getByRole('dialog', { name: 'Restore previous session' });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Restore selected' }).click();
  await expect(relaunched.page.getByRole('tab', { name: 'alpha.md' })).toBeVisible();
  await relaunched.app.close();
});

test('forwards a Markdown file from a second Electron instance to the responsive primary instance', async ({
  markora,
}) => {
  const initialTabCount = await documentTabs(markora).count();
  const forwardedPath = alphaPath(markora.temporaryDirectory);

  await markora.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.minimize();
  });
  await expect
    .poll(() =>
      markora.app.evaluate(({ BrowserWindow }) => Boolean(BrowserWindow.getAllWindows()[0]?.isMinimized())),
    )
    .toBe(true);

  const secondary = await forwardThroughSecondElectronInstance(markora, forwardedPath);

  expect(secondary.exitCode, secondary.stderr).toBe(0);
  await expect(documentTabs(markora).filter({ hasText: 'alpha.md' })).toBeVisible();
  await expect(documentTabs(markora)).toHaveCount(initialTabCount + 1);
  await expect.poll(() => markora.page.evaluate(() => document.hasFocus())).toBe(true);
  const primaryState = await markora.app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return {
      windowCount: windows.length,
      rendererCrashed: windows[0]?.webContents.isCrashed() ?? true,
      focused: windows[0]?.isFocused() ?? false,
      minimized: windows[0]?.isMinimized() ?? true,
    };
  });
  expect(primaryState).toEqual({
    windowCount: 1,
    rendererCrashed: false,
    focused: true,
    minimized: false,
  });
  await expect(documentTabs(markora).filter({ hasText: 'alpha.md' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('opens multiple Markdown files supplied through command-line arguments', async ({ markora }) => {
  await markora.app.close();
  const files = [
    alphaPath(markora.temporaryDirectory),
    path.join(markora.workspaceDirectory, 'nested', 'beta.markdown'),
  ];
  const launched = await launchElectronWithUserData(markora.userDataDirectory, files);
  await expect(launched.page.getByRole('tab', { name: 'alpha.md' })).toBeVisible();
  await expect(launched.page.getByRole('tab', { name: 'beta.markdown' })).toBeVisible();
  await launched.app.close();
});

test('passes axe-core WCAG A/AA scans in the real Electron renderer and command palette', async ({
  markora,
}) => {
  const shellResults = await runAxeInElectron(markora, 'main.app');
  expect(shellResults.violations).toEqual([]);

  await markora.page.keyboard.press('Control+Shift+P');
  await expect(markora.page.getByRole('dialog', { name: 'Command Palette' })).toBeVisible();
  const paletteResults = await runAxeInElectron(markora, '.command-palette');
  expect(paletteResults.violations).toEqual([]);
});
