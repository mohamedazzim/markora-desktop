import { expect, test } from './electron-fixture';

test('launches the development application with the project Electron executable', async ({ markora }) => {
  await expect(markora.page.getByText('Markora', { exact: true })).toBeVisible();
  await expect(markora.page.getByLabel('Structured Markdown editor')).toBeEditable();
  const executable = await markora.app.evaluate(({ app }) => app.getPath('exe'));
  expect(executable.toLocaleLowerCase()).toContain('node_modules\\electron\\dist\\electron.exe');
});

test('dispatches native menu items through the renderer command registry', async ({ markora }) => {
  const before = await markora.page.getByRole('tab').count();
  const dispatched = await markora.app.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('file.new');
    const window = BrowserWindow.getFocusedWindow();
    if (!item?.click || !window) return false;
    item.click(item, window, { triggeredByAccelerator: false });
    return true;
  });

  expect(dispatched).toBe(true);
  await expect(markora.page.getByRole('tab')).toHaveCount(before + 1);
});
