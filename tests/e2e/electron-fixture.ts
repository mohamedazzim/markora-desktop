import { expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const projectRoot = path.resolve(__dirname, '../..');

export interface DialogPlan {
  readonly markdownFiles?: readonly string[];
  readonly imageFiles?: readonly string[];
  readonly pandocFiles?: readonly string[];
  readonly themeFiles?: readonly string[];
  readonly workspaceDirectory?: string;
  readonly saveByExtension?: Readonly<Record<string, string>>;
  readonly fallbackSaveFiles?: readonly string[];
}

export interface MarkoraElectronFixture {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly startupMilliseconds: number;
  readonly temporaryDirectory: string;
  readonly userDataDirectory: string;
  readonly workspaceDirectory: string;
  readonly consoleErrors: string[];
}

function localElectronExecutable(): string {
  if (process.env.MARKORA_ELECTRON_EXECUTABLE) return process.env.MARKORA_ELECTRON_EXECUTABLE;
  return path.join(
    projectRoot,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );
}

async function makeFixtureFiles(temporaryDirectory: string): Promise<string> {
  const workspaceDirectory = path.join(temporaryDirectory, 'workspace');
  await fs.mkdir(path.join(workspaceDirectory, 'nested'), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(workspaceDirectory, 'alpha.md'),
      '# Alpha\n\nworkspace needle one\n\nUnicode: नमस्ते 🌍\n',
      'utf8',
    ),
    fs.writeFile(
      path.join(workspaceDirectory, 'nested', 'beta.markdown'),
      '# Beta\r\n\r\nworkspace needle two\r\n',
      'utf8',
    ),
    fs.writeFile(
      path.join(workspaceDirectory, 'ARCHITECTURE_DIAGRAMS.md'),
      '# Architecture diagrams\n\n## Dataset split methodology\n\nDiagram source.\n',
      'utf8',
    ),
    fs.writeFile(path.join(workspaceDirectory, 'My Document.md'), '# Encoded filename\n', 'utf8'),
    fs.writeFile(path.join(workspaceDirectory, 'ஆவணம்.md'), '# Unicode filename\n', 'utf8'),
    fs.writeFile(path.join(workspaceDirectory, 'ignored.txt'), 'workspace needle ignored\n', 'utf8'),
    fs.writeFile(
      path.join(temporaryDirectory, 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8V8AAAAASUVORK5CYII=',
        'base64',
      ),
    ),
  ]);
  return workspaceDirectory;
}

export async function installDialogPlan(application: ElectronApplication, plan: DialogPlan): Promise<void> {
  await application.evaluate(async ({ dialog }, serializedPlan) => {
    type OpenOptions = {
      properties?: string[];
      filters?: Array<{ extensions?: string[] }>;
      title?: string;
    };
    type SaveOptions = { filters?: Array<{ extensions?: string[] }>; defaultPath?: string };
    const markdownFiles = [...(serializedPlan.markdownFiles ?? [])];
    const imageFiles = [...(serializedPlan.imageFiles ?? [])];
    const pandocFiles = [...(serializedPlan.pandocFiles ?? [])];
    const themeFiles = [...(serializedPlan.themeFiles ?? [])];
    const fallbackSaveFiles = [...(serializedPlan.fallbackSaveFiles ?? [])];
    const saveByExtension = { ...(serializedPlan.saveByExtension ?? {}) };

    const mockDialog = dialog as unknown as {
      showOpenDialog(...args: unknown[]): Promise<{ canceled: boolean; filePaths: string[] }>;
      showSaveDialog(...args: unknown[]): Promise<{ canceled: boolean; filePath?: string }>;
    };
    mockDialog.showOpenDialog = async (...args: unknown[]) => {
      const options = (args.at(-1) ?? {}) as OpenOptions;
      if (options.properties?.includes('openDirectory')) {
        return serializedPlan.workspaceDirectory
          ? { canceled: false, filePaths: [serializedPlan.workspaceDirectory] }
          : { canceled: true, filePaths: [] };
      }
      const extensions = options.filters?.flatMap((filter) => filter.extensions ?? []) ?? [];
      const image = extensions.some((extension) =>
        /^(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(extension),
      );
      const pandoc =
        options.title?.toLocaleLowerCase().includes('pandoc') ||
        extensions.some((extension) => /^(?:exe|docx|odt|rtf|html?|tex)$/i.test(extension));
      const theme = options.title?.toLocaleLowerCase().includes('theme');
      const selected = image
        ? imageFiles.shift()
        : pandoc
          ? pandocFiles.shift()
          : theme
            ? themeFiles.shift()
            : markdownFiles.shift();
      return selected ? { canceled: false, filePaths: [selected] } : { canceled: true, filePaths: [] };
    };
    mockDialog.showSaveDialog = async (...args: unknown[]) => {
      const options = (args.at(-1) ?? {}) as SaveOptions;
      const extension =
        options.filters?.flatMap((filter) => filter.extensions ?? [])[0]?.toLocaleLowerCase() ||
        options.defaultPath?.split('.').pop()?.toLocaleLowerCase() ||
        '';
      const selected = saveByExtension[extension] ?? fallbackSaveFiles.shift();
      return selected ? { canceled: false, filePath: selected } : { canceled: true };
    };
  }, plan);
}

export async function launchElectronWithUserData(
  userDataDirectory: string,
  extraApplicationArguments: readonly string[] = [],
): Promise<{ app: ElectronApplication; page: Page; startupMilliseconds: number }> {
  const launchStartedAt = performance.now();
  await fs.mkdir(userDataDirectory, { recursive: true });
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  environment.MARKORA_E2E = '1';
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath: localElectronExecutable(),
    args: [
      `--user-data-dir=${userDataDirectory}`,
      ...(process.env.MARKORA_ELECTRON_EXECUTABLE ? [] : [projectRoot]),
      ...extraApplicationArguments,
    ],
    cwd: projectRoot,
    env: environment,
  });
  const page = await application.firstWindow();
  const startupErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') startupErrors.push(message.text());
  });
  page.on('pageerror', (error) => startupErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  try {
    await expect(page.locator('main.app')).toBeVisible();
  } catch (error) {
    const detail = startupErrors.join('\n') || 'No renderer startup error was captured.';
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nRenderer startup: ${detail}`);
  }
  return {
    app: application,
    page,
    startupMilliseconds: performance.now() - launchStartedAt,
  };
}

async function launchMarkora(temporaryDirectory: string): Promise<MarkoraElectronFixture> {
  const userDataDirectory = path.join(temporaryDirectory, 'user-data');
  const workspaceDirectory = await makeFixtureFiles(temporaryDirectory);
  await fs.mkdir(userDataDirectory, { recursive: true });
  await expect
    .poll(async () => {
      try {
        await fs.access(localElectronExecutable());
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);

  const { app: application, page, startupMilliseconds } = await launchElectronWithUserData(userDataDirectory);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await expect(page.getByRole('tab', { name: /Untitled\.md/ })).toBeVisible();
  return {
    app: application,
    page,
    startupMilliseconds,
    temporaryDirectory,
    userDataDirectory,
    workspaceDirectory,
    consoleErrors,
  };
}

export const test = base.extend<{ markora: MarkoraElectronFixture }>({
  // Playwright requires object destructuring here even though this fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  markora: async ({}, provide, testInfo) => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-electron-e2e-'));
    const markora = await launchMarkora(temporaryDirectory);
    await provide(markora);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('renderer-errors.txt', {
        body: Buffer.from(markora.consoleErrors.join('\n') || 'No renderer console errors were captured.'),
        contentType: 'text/plain',
      });
    }
    await markora.app.close().catch(() => undefined);
    const resolved = path.resolve(temporaryDirectory);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolved.startsWith(tempRoot))
      throw new Error(`Refusing to remove non-temporary E2E path: ${resolved}`);
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  },
});

export { expect } from '@playwright/test';

export async function replaceStructuredDocument(page: Page, text: string): Promise<void> {
  const editor = page.getByLabel('Structured Markdown editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

export async function replaceSourceDocument(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const editor = page.getByLabel('Markdown source editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

export async function sourceDocumentText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  return (await page.getByLabel('Markdown source editor').textContent()) ?? '';
}
