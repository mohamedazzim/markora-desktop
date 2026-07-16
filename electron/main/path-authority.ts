import path from 'node:path';

const authorizedFiles = new Set<string>();
const authorizedWorkspaces = new Set<string>();
const authorizedAssets = new Set<string>();

function key(candidate: string): string {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function authorizeFile(candidate: string): string {
  const resolved = path.resolve(candidate);
  authorizedFiles.add(key(resolved));
  return resolved;
}

export function authorizeWorkspace(candidate: string): string {
  const resolved = path.resolve(candidate);
  authorizedWorkspaces.add(key(resolved));
  return resolved;
}

export function authorizeAsset(candidate: string): string {
  const resolved = path.resolve(candidate);
  authorizedAssets.add(key(resolved));
  return resolved;
}

export function isAuthorizedWorkspace(candidate: string): boolean {
  return authorizedWorkspaces.has(key(candidate));
}

export function isAuthorizedFile(candidate: string): boolean {
  const candidateKey = key(candidate);
  if (authorizedFiles.has(candidateKey)) return true;
  return Array.from(authorizedWorkspaces).some((workspace) => isPathInside(workspace, candidateKey));
}

export function isAuthorizedAsset(candidate: string): boolean {
  const candidateKey = key(candidate);
  if (authorizedAssets.has(candidateKey)) return true;
  return Array.from(authorizedWorkspaces).some((workspace) => isPathInside(workspace, candidateKey));
}

export function assertAuthorizedFile(candidate: string): void {
  if (!isAuthorizedFile(candidate)) {
    throw new Error('The file was not selected by the user or opened from an authorized workspace.');
  }
}

export function assertAuthorizedWorkspace(candidate: string): void {
  if (!isAuthorizedWorkspace(candidate)) {
    throw new Error('The workspace was not selected by the user.');
  }
}

export function assertAuthorizedAsset(candidate: string): void {
  if (!isAuthorizedAsset(candidate)) {
    throw new Error('The asset path was not selected or created through Markora.');
  }
}

export function clearPathAuthorityForTests(): void {
  authorizedFiles.clear();
  authorizedWorkspaces.clear();
  authorizedAssets.clear();
}
