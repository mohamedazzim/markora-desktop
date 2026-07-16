import { expect, test, installDialogPlan } from './electron-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';

const alphaPath = (temporaryDirectory: string) => path.join(temporaryDirectory, 'workspace', 'alpha.md');

async function writeExternalFile(filePath: string, contents: string): Promise<void> {
  await fs.writeFile(filePath, contents, 'utf8');
}

test('capture baseline screenshots for audit', async ({ markora }) => {
  const { page, temporaryDirectory } = markora;
  const screenshotDir = path.join(temporaryDirectory, 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });

  // 1. Empty document (structured mode default)
  await page.screenshot({ path: path.join(screenshotDir, 'empty_document.png') });

  // 1b. Workspace tree states: icon rows are part of the visual audit contract.
  await installDialogPlan(markora.app, { workspaceDirectory: markora.workspaceDirectory });
  await page.getByRole('button', { name: 'Open workspace' }).click();
  const workspaceTree = page.getByRole('tree', { name: 'Workspace files' });
  await expect(workspaceTree).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'tree_expanded.png') });
  const firstFolder = workspaceTree.locator('button[data-tree-folder]').first();
  await firstFolder.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(screenshotDir, 'tree_collapsed.png') });
  await firstFolder.click();

  // 2. Structured editing with text
  const editor = page.getByLabel('Structured Markdown editor');
  await editor.click();
  await page.keyboard.insertText(
    '# Markdown Heading 1\n\nThis is structured editing mode. Markora supports rich typography, **bold text**, *italic text*, lists, tables, and blocks.\n\n',
  );
  await page.screenshot({ path: path.join(screenshotDir, 'structured_editing.png') });

  // 3. Source editing
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotDir, 'source_editing.png') });

  // Switch back to Structured
  await page.getByRole('button', { name: 'Structured', exact: true }).click();
  await page.waitForTimeout(500);

  // 4. Sidebar open (Files tab)
  await page.getByRole('button', { name: 'Toggle outline' }).click(); // toggle open
  await page.screenshot({ path: path.join(screenshotDir, 'sidebar_open.png') });

  // 5. Outline open
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.screenshot({ path: path.join(screenshotDir, 'outline_open.png') });

  // 6. Search open (Workspace search tab)
  await page.getByRole('tab', { name: 'Workspace search' }).click();
  await page.screenshot({ path: path.join(screenshotDir, 'search_open.png') });

  // 7. Settings open (Appearance settings panel)
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Appearance and writing modes...' }).click();
  const appearancePanel = page.getByRole('dialog', { name: 'Appearance and writing modes' });
  await expect(appearancePanel).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'settings.png') });

  // Let's toggle theme to dark in appearance settings to get a dark theme screenshot
  // Wait, let's close the appearance settings for a moment or take screenshot of it
  await appearancePanel.getByRole('button', { name: 'Close appearance settings' }).click();
  await expect(appearancePanel).toBeHidden();

  // Let's trigger a disk conflict dialog
  const filePath = alphaPath(temporaryDirectory);
  await fs.writeFile(filePath, '# Alpha\n\nOriginal file text', 'utf8');
  await installDialogPlan(markora.app, { markdownFiles: [filePath] });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await page.waitForTimeout(1000);

  // Make editor dirty
  const activeEditor = page.getByLabel('Structured Markdown editor');
  await activeEditor.click();
  await page.keyboard.insertText('Making changes here.');
  // Write externally
  await writeExternalFile(filePath, '# Alpha\n\nConflicting external change.');
  // Wait for watcher/conflict dialog
  const conflict = page.getByRole('dialog', { name: 'Resolve disk conflict' });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(screenshotDir, 'conflict_dialog.png') });

  // Clean up dialog by reloading from disk
  await conflict.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(conflict).toBeHidden();

  // 8. Dark theme screenshot
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Appearance and writing modes...' }).click();
  const appearancePanel2 = page.getByRole('dialog', { name: 'Appearance and writing modes' });
  await expect(appearancePanel2).toBeVisible();
  // Select Dark color mode
  // The panel uses select dropdown or swatch card. Let's select colorMode 'dark'
  await appearancePanel2.locator('select').first().selectOption('dark');
  await page.waitForTimeout(500);
  await appearancePanel2.getByRole('button', { name: 'Close appearance settings' }).click();
  await page.screenshot({ path: path.join(screenshotDir, 'dark_theme.png') });

  // 9. Light theme screenshot
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Appearance and writing modes...' }).click();
  const appearancePanel3 = page.getByRole('dialog', { name: 'Appearance and writing modes' });
  await expect(appearancePanel3).toBeVisible();
  await appearancePanel3.locator('select').first().selectOption('light');
  await page.waitForTimeout(500);
  await appearancePanel3.getByRole('button', { name: 'Close appearance settings' }).click();
  await page.screenshot({ path: path.join(screenshotDir, 'light_theme.png') });

  // 10. Recovery dialog screenshot
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Autosave seconds').fill('5');
  const activeEditor2 = page.getByLabel('Structured Markdown editor');
  await activeEditor2.click();
  await page.keyboard.insertText('Triggering recovery snap.');
  await page.waitForTimeout(6000);
  await page.reload();
  const recoveryDialog = page.getByRole('dialog', { name: 'Restore previous session' });
  await expect(recoveryDialog).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(screenshotDir, 'recovery_dialog.png') });
  await recoveryDialog.getByRole('button', { name: 'Restore selected' }).click();
  await expect(recoveryDialog).toBeHidden();
});
