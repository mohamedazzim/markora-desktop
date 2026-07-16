import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyLocalImageAsset, downloadRemoteImageAsset } from '../../electron/main/image-assets';
import { runPandocConversion, type PandocChildProcess, type PandocSpawn } from '../../electron/main/pandoc';
import { WorkspaceSearchService } from '../../electron/main/workspace-search';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('image asset service integration', () => {
  it('copies a local image and downloads a remote image through real filesystem and HTTP adapters', async () => {
    const workspace = await temporaryDirectory('markora-image-integration-');
    const notes = path.join(workspace, 'notes');
    const documentPath = path.join(notes, 'Unicode 文档.md');
    const originalPath = path.join(workspace, 'original image.png');
    await mkdir(notes, { recursive: true });
    await writeFile(documentPath, '# Images\n');
    await writeFile(originalPath, new Uint8Array([1, 2, 3, 4]));

    const context = { documentPath, workspaceRoot: workspace };
    const copied = await copyLocalImageAsset({
      sourcePath: originalPath,
      strategy: 'assets',
      filename: '猫 image.png',
      context,
    });
    expect(copied.markdownPath).toBe('assets/猫 image.png');
    expect([...(await readFile(copied.assetPath))]).toEqual([1, 2, 3, 4]);

    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-disposition': "attachment; filename*=UTF-8''remote-%E7%8C%AB.png",
      });
      response.end(Buffer.from([137, 80, 78, 71, 5]));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The HTTP fixture did not bind a TCP port.');

    const downloaded = await downloadRemoteImageAsset({
      url: `http://127.0.0.1:${address.port}/image.png`,
      strategy: 'document-assets',
      filename: '',
      context,
      timeoutMs: 5_000,
      maxBytes: 1_024,
    });
    expect(downloaded.filename).toBe('remote-猫.png');
    expect(downloaded.markdownPath).toBe('Unicode 文档.assets/remote-猫.png');
    expect([...(await readFile(downloaded.assetPath))]).toEqual([137, 80, 78, 71, 5]);
  });
});

class MockPandocChild extends EventEmitter implements PandocChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    return true;
  });
}

describe('Pandoc process integration', () => {
  it('validates real paths and drives a mocked executable with argv and shell execution disabled', async () => {
    const root = await temporaryDirectory('markora-pandoc-integration-');
    const executable = path.join(root, 'pandoc.exe');
    const inputPath = path.join(root, 'input & literal.md');
    const outputPath = path.join(root, 'output & literal.docx');
    await writeFile(executable, 'mock executable');
    await writeFile(inputPath, '# Converted\n');

    const calls: Array<{ executable: string; args: readonly string[]; shell: boolean | undefined }> = [];
    let invocation = 0;
    const spawn: PandocSpawn = (candidate, args, options) => {
      const child = new MockPandocChild();
      calls.push({ executable: candidate, args: [...args], shell: options.shell });
      invocation += 1;
      if (invocation === 1) {
        queueMicrotask(() => {
          child.stdout.end('pandoc 3.7.0\n');
          child.emit('close', 0, null);
        });
      } else {
        void writeFile(outputPath, Buffer.from('mock-docx')).then(() => {
          child.stdout.end('converted\n');
          child.emit('close', 0, null);
        });
      }
      return child;
    };

    const result = await runPandocConversion(
      executable,
      { direction: 'export', format: 'docx', inputPath, outputPath },
      { timeoutMs: 5_000 },
      { spawn, platform: 'win32', env: {} },
    );

    expect(result).toMatchObject({ pandocVersion: '3.7.0', outputPath, exitCode: 0 });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.shell === false)).toBe(true);
    expect(calls[1]?.args.at(-1)).toBe(inputPath);
    expect(calls[1]?.args).toContain(outputPath);
    expect(await readFile(outputPath, 'utf8')).toBe('mock-docx');
  });
});

describe('workspace replacement integration', () => {
  it('searches actual files, requires preview confirmation, writes backups, and preserves ignored output', async () => {
    const workspace = await temporaryDirectory('markora-workspace-integration-');
    const documentPath = path.join(workspace, 'notes', 'one.md');
    const ignoredPath = path.join(workspace, 'node_modules', 'ignored.md');
    await mkdir(path.dirname(documentPath), { recursive: true });
    await mkdir(path.dirname(ignoredPath), { recursive: true });
    await writeFile(documentPath, '# Alpha\n\nalpha alpha\n');
    await writeFile(ignoredPath, 'alpha must remain\n');

    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: { workspaceRoot: workspace, query: 'alpha', caseSensitive: false },
      replacement: 'omega',
    });
    expect(preview.selectedFileCount).toBe(1);
    expect(preview.selectedMatchCount).toBe(3);
    expect(await readFile(documentPath, 'utf8')).toContain('alpha alpha');

    const result = await service.applyReplacePreview({
      previewToken: preview.previewToken,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
      createBackups: true,
    });
    expect(result).toMatchObject({ replacedFileCount: 1, replacedMatchCount: 3, failedFileCount: 0 });
    expect(await readFile(documentPath, 'utf8')).toBe('# omega\n\nomega omega\n');
    expect(await readFile(ignoredPath, 'utf8')).toBe('alpha must remain\n');
    const backup = result.files[0]?.backupPath;
    expect(backup).toBeTruthy();
    expect(await readFile(backup!, 'utf8')).toBe('# Alpha\n\nalpha alpha\n');
  });
});
