import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAuthorizedAsset,
  assertAuthorizedFile,
  assertAuthorizedWorkspace,
  authorizeAsset,
  authorizeFile,
  authorizeWorkspace,
  clearPathAuthorityForTests,
  isPathInside,
} from '../../electron/main/path-authority';

afterEach(clearPathAuthorityForTests);

describe('main-process path authority', () => {
  it('authorizes only explicitly selected files', () => {
    const selected = path.resolve('C:/documents/selected.md');
    authorizeFile(selected);
    expect(() => assertAuthorizedFile(selected)).not.toThrow();
    expect(() => assertAuthorizedFile(path.resolve('C:/documents/private.md'))).toThrow(/not selected/);
  });

  it('authorizes descendants of a selected workspace but not sibling prefixes', () => {
    const workspace = path.resolve('C:/work/notes');
    authorizeWorkspace(workspace);
    expect(() => assertAuthorizedWorkspace(workspace)).not.toThrow();
    expect(() => assertAuthorizedFile(path.join(workspace, 'nested', 'note.md'))).not.toThrow();
    expect(() => assertAuthorizedFile(path.resolve('C:/work/notes-secret/note.md'))).toThrow();
  });

  it('keeps asset authority separate from document authority', () => {
    const asset = path.resolve('C:/images/photo.png');
    authorizeAsset(asset);
    expect(() => assertAuthorizedAsset(asset)).not.toThrow();
    expect(() => assertAuthorizedFile(asset)).toThrow();
  });

  it('rejects path traversal outside the selected root', () => {
    const workspace = path.resolve('C:/work/project');
    expect(isPathInside(workspace, path.join(workspace, 'assets', 'image.png'))).toBe(true);
    expect(isPathInside(workspace, path.join(workspace, '..', 'secret.png'))).toBe(false);
  });
});
