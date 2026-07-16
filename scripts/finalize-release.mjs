import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

export async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function expectedReleasePaths(root, version) {
  const releaseDirectory = path.join(root, 'release');
  return {
    releaseDirectory,
    installer: path.join(releaseDirectory, `Markora-${version}-Setup-x64.exe`),
    portable: path.join(releaseDirectory, `Markora-${version}-Portable-x64.exe`),
    unpackedExecutable: path.join(releaseDirectory, 'win-unpacked', 'Markora.exe'),
    releaseNotesSource: path.join(root, 'docs', `RELEASE_NOTES_${version}.md`),
    releaseNotes: path.join(releaseDirectory, `Markora-${version}-Release-Notes.md`),
    verifierSource: path.join(root, 'scripts', 'verify-clean-install.ps1'),
    verifier: path.join(releaseDirectory, 'verify-clean-install.ps1'),
    cleanVmPlanSource: path.join(root, 'docs', 'CLEAN_VM_TEST_PLAN.md'),
    cleanVmPlan: path.join(releaseDirectory, 'CLEAN_VM_TEST_PLAN.md'),
    // Keep prior patch-release metadata immutable. Each release owns a
    // versioned checksum and manifest file instead of overwriting the generic
    // names emitted by older releases.
    checksums: path.join(releaseDirectory, `SHA256SUMS-${version}.txt`),
    manifest: path.join(releaseDirectory, `release-manifest-${version}.json`),
  };
}

export function checksumText(records) {
  return `${records.map((record) => `${record.sha256} *${record.relativePath.replaceAll('\\', '/')}`).join('\n')}\n`;
}

async function assertFile(filePath, label) {
  try {
    await access(filePath);
    const details = await stat(filePath);
    if (!details.isFile() || details.size === 0) throw new Error('file is empty');
    return details;
  } catch (error) {
    throw new Error(
      `${label} is missing or invalid at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function finalizeRelease(root = projectRoot) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = String(packageJson.version);
  const paths = expectedReleasePaths(root, version);
  const artifacts = [
    { kind: 'installer', filePath: paths.installer },
    { kind: 'portable', filePath: paths.portable },
    { kind: 'unpacked-executable', filePath: paths.unpackedExecutable },
  ];

  await assertFile(paths.releaseNotesSource, 'Versioned release notes');
  await copyFile(paths.releaseNotesSource, paths.releaseNotes);
  await assertFile(paths.verifierSource, 'Clean-install verifier');
  await copyFile(paths.verifierSource, paths.verifier);
  await assertFile(paths.cleanVmPlanSource, 'Clean VM test plan');
  await copyFile(paths.cleanVmPlanSource, paths.cleanVmPlan);
  artifacts.push({ kind: 'release-notes', filePath: paths.releaseNotes });
  artifacts.push({ kind: 'verification-script', filePath: paths.verifier });
  artifacts.push({ kind: 'clean-vm-plan', filePath: paths.cleanVmPlan });

  const records = [];
  for (const artifact of artifacts) {
    const details = await assertFile(artifact.filePath, artifact.kind);
    records.push({
      kind: artifact.kind,
      relativePath: path.relative(paths.releaseDirectory, artifact.filePath),
      byteLength: details.size,
      sha256: await sha256(artifact.filePath),
    });
  }

  await writeFile(paths.checksums, checksumText(records), 'utf8');
  const manifest = {
    schemaVersion: 1,
    product: 'Markora',
    version,
    platform: 'win32',
    architecture: 'x64',
    generatedAt: new Date().toISOString(),
    signed: false,
    artifacts: records,
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { paths, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  finalizeRelease()
    .then(({ paths, manifest }) => {
      process.stdout.write(`Finalized Markora ${manifest.version}: ${paths.manifest}\n`);
      process.stdout.write(`SHA-256 checksums: ${paths.checksums}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
