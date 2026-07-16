export interface ReleasePaths {
  releaseDirectory: string;
  installer: string;
  portable: string;
  unpackedExecutable: string;
  releaseNotesSource: string;
  releaseNotes: string;
  verifierSource: string;
  verifier: string;
  cleanVmPlanSource: string;
  cleanVmPlan: string;
  checksums: string;
  manifest: string;
}

export interface ChecksumRecord {
  relativePath: string;
  sha256: string;
}

export function sha256(filePath: string): Promise<string>;
export function expectedReleasePaths(root: string, version: string): ReleasePaths;
export function checksumText(records: readonly ChecksumRecord[]): string;
export function finalizeRelease(root?: string): Promise<{
  paths: ReleasePaths;
  manifest: {
    schemaVersion: 1;
    product: 'Markora';
    version: string;
    platform: 'win32';
    architecture: 'x64';
    generatedAt: string;
    signed: false;
    artifacts: Array<ChecksumRecord & { kind: string; byteLength: number }>;
  };
}>;
