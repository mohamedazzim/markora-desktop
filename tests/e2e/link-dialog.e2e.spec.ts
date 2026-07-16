import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, replaceStructuredDocument, sourceDocumentText, test } from './electron-fixture';

test('opens, applies, edits, and removes a link with the shared modal', async ({ markora }) => {
  await replaceStructuredDocument(markora.page, 'Link text');
  const editor = markora.page.getByLabel('Structured Markdown editor');
  await markora.page.locator('.structured-prosemirror').click({ force: true });
  await markora.page.keyboard.press('Control+A');
  await expect(markora.page.getByTitle('Link', { exact: true })).toBeVisible();
  await markora.page.getByTitle('Link', { exact: true }).click();

  const dialog = markora.page.getByRole('dialog', { name: 'Edit link' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Enter a URL, relative path, email address, or heading anchor.'),
  ).toBeVisible();
  const destination = dialog.getByLabel('Link destination');
  await expect(destination).toBeFocused();
  await destination.fill('https://example.com/docs');
  await dialog.getByRole('button', { name: 'Apply link' }).click();

  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/docs');
  expect(await sourceDocumentText(markora.page)).toContain('[Link text](https://example.com/docs)');

  await markora.page.getByRole('button', { name: 'Structured', exact: true }).click();
  await markora.page.getByLabel('Edit link dialog').click();
  const existingDialog = markora.page.getByRole('dialog', { name: 'Edit link' });
  await expect(existingDialog.getByLabel('Link destination')).toHaveValue('https://example.com/docs');
  await expect(existingDialog.getByRole('button', { name: 'Remove link' })).toBeVisible();
  await existingDialog.getByRole('button', { name: 'Remove link' }).click();
  await expect(editor.locator('a')).toHaveCount(0);
  expect(await sourceDocumentText(markora.page)).toContain('Link text');
});

test('keeps the modal opaque and isolated from document theme tokens', async ({ markora }) => {
  await replaceStructuredDocument(markora.page, 'Theme isolation');
  const editor = markora.page.getByLabel('Structured Markdown editor');
  await editor.click();
  await markora.page.keyboard.press('Control+A');
  await markora.page.getByTitle('Link', { exact: true }).click();
  const dialog = markora.page.getByRole('dialog', { name: 'Edit link' });
  await expect(dialog).toBeVisible();
  const styles = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    const input = element.querySelector('input');
    const inputStyle = input ? getComputedStyle(input) : null;
    return {
      background: style.backgroundColor,
      color: style.color,
      inputBackground: inputStyle?.backgroundColor,
      inputColor: inputStyle?.color,
      overlay: getComputedStyle(element.parentElement!).backgroundColor,
      bodyDialogBackground: document.body.style.getPropertyValue('--dialog-bg'),
      bodyDocumentToken: document.body.style.getPropertyValue('--doc-bg'),
    };
  });
  expect(styles.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.inputBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.bodyDialogBackground).not.toBe('');
  expect(styles.bodyDocumentToken).toBe('');
  const screenshotPath = path.resolve('test-results/visual/dialogs/link/structured-link-dialog.png');
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await markora.page.screenshot({ path: screenshotPath, fullPage: true });

  await markora.page.keyboard.press('Escape');
  await markora.page.getByRole('tab', { name: 'Settings' }).click();
  await markora.page.getByRole('button', { name: /Appearance and writing modes/ }).click();
  const appearanceDialog = markora.page.getByRole('dialog', { name: 'Appearance and writing modes' });
  await expect(appearanceDialog).toBeVisible();
  await appearanceDialog.getByLabel('Color mode').selectOption('dark');
  await appearanceDialog.getByRole('radio', { name: /Markora Midnight/ }).check();
  await appearanceDialog.getByRole('button', { name: 'Close appearance settings' }).click();

  await markora.page.getByLabel('Edit link dialog').click();
  const midnightDialog = markora.page.getByRole('dialog', { name: 'Edit link' });
  await expect(midnightDialog).toBeVisible();
  const midnightScreenshot = path.resolve(
    'test-results/visual/dialogs/link/structured-link-dialog-midnight.png',
  );
  await markora.page.screenshot({ path: midnightScreenshot, fullPage: true });
  await expect(midnightDialog.getByLabel('Link destination')).toBeFocused();
});
