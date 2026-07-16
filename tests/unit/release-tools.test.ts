import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checksumText,
  expectedReleasePaths,
  finalizeRelease,
  sha256,
} from '../../scripts/finalize-release.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe('Windows release tooling', () => {
  it('derives versioned installer, portable, unpacked, notes, and checksum paths', () => {
    const paths = expectedReleasePaths('C:\\repo', '0.2.0');
    expect(paths.installer).toMatch(/Markora-0\.2\.0-Setup-x64\.exe$/);
    expect(paths.portable).toMatch(/Markora-0\.2\.0-Portable-x64\.exe$/);
    expect(paths.unpackedExecutable).toMatch(/win-unpacked[\\/]Markora\.exe$/);
    expect(paths.releaseNotes).toMatch(/Markora-0\.2\.0-Release-Notes\.md$/);
    expect(paths.verifier).toMatch(/verify-clean-install\.ps1$/);
    expect(paths.cleanVmPlan).toMatch(/CLEAN_VM_TEST_PLAN\.md$/);
    expect(paths.checksums).toMatch(/SHA256SUMS-0\.2\.0\.txt$/);
    expect(paths.manifest).toMatch(/release-manifest-0\.2\.0\.json$/);
  });

  it('hashes artifact bytes with SHA-256', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'markora-release-'));
    temporaryDirectories.push(root);
    const artifact = path.join(root, 'artifact.exe');
    await writeFile(artifact, Buffer.from([0, 1, 2, 3, 255]));
    const expected = createHash('sha256')
      .update(Buffer.from([0, 1, 2, 3, 255]))
      .digest('hex');
    expect(await sha256(artifact)).toBe(expected);
  });

  it('emits standard checksum lines with normalized path separators', async () => {
    const output = checksumText([
      { relativePath: 'win-unpacked\\Markora.exe', sha256: 'a'.repeat(64) },
      { relativePath: 'Markora-0.2.0-Setup-x64.exe', sha256: 'b'.repeat(64) },
    ]);
    expect(output).toBe(
      `${'a'.repeat(64)} *win-unpacked/Markora.exe\n${'b'.repeat(64)} *Markora-0.2.0-Setup-x64.exe\n`,
    );

    const root = await mkdtemp(path.join(os.tmpdir(), 'markora-checksum-'));
    temporaryDirectories.push(root);
    const file = path.join(root, 'SHA256SUMS-0.2.0.txt');
    await writeFile(file, output, 'utf8');
    expect(await readFile(file, 'utf8')).toContain('*win-unpacked/Markora.exe');
  });

  it('finalizes only the expected versioned artifacts and support files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'markora-finalize-'));
    temporaryDirectories.push(root);
    const paths = expectedReleasePaths(root, '0.2.0');
    await Promise.all([
      mkdir(path.dirname(paths.unpackedExecutable), { recursive: true }),
      mkdir(path.dirname(paths.releaseNotesSource), { recursive: true }),
      mkdir(path.dirname(paths.verifierSource), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.0' })),
      writeFile(paths.installer, 'installer'),
      writeFile(paths.portable, 'portable'),
      writeFile(paths.unpackedExecutable, 'unpacked'),
      writeFile(paths.releaseNotesSource, '# Notes'),
      writeFile(paths.verifierSource, 'Write-Output ok'),
      writeFile(paths.cleanVmPlanSource, '# Plan'),
    ]);

    const result = await finalizeRelease(root);
    expect(result.manifest.version).toBe('0.2.0');
    expect(result.manifest.artifacts.map((item) => item.kind)).toEqual([
      'installer',
      'portable',
      'unpacked-executable',
      'release-notes',
      'verification-script',
      'clean-vm-plan',
    ]);
    expect(await readFile(paths.checksums, 'utf8')).toContain('*Markora-0.2.0-Setup-x64.exe');
    expect(JSON.parse(await readFile(paths.manifest, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      signed: false,
      architecture: 'x64',
    });
  });

  it('checks redirected Windows desktop known folders instead of assuming USERPROFILE\\Desktop', async () => {
    const verifier = await readFile(path.resolve('scripts', 'verify-clean-install.ps1'), 'utf8');
    expect(verifier).toContain("GetFolderPath('Desktop')");
    expect(verifier).toContain("GetFolderPath('CommonDesktopDirectory')");
    expect(verifier).not.toContain("Join-Path $env:USERPROFILE 'Desktop\\Markora.lnk'");
  });
});
