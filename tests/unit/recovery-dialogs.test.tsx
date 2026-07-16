import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictDialog } from '../../src/renderer/recovery/ConflictDialog';
import { RecoveryCenterDialog } from '../../src/renderer/recovery/RecoveryCenterDialog';
import type { EditorDiskConflict, RestorePlanItem } from '../../src/renderer/recovery/recovery-controller';

const fingerprint = { modifiedAt: 1, size: 4, sha256: 'a'.repeat(64) };

afterEach(cleanup);

function conflict(kind: 'modified' | 'deleted' | 'renamed' = 'modified'): EditorDiskConflict {
  return {
    document: {
      id: 'doc',
      path: 'C:\\notes\\one.md',
      name: 'one.md',
      content: 'editor text',
      lineEnding: 'LF',
      mode: 'source',
      active: true,
      dirty: true,
    },
    result: {
      status: 'conflict',
      conflict: {
        kind,
        path: 'C:\\notes\\one.md',
        renamedPath: kind === 'renamed' ? 'C:\\notes\\renamed.md' : undefined,
        expected: fingerprint,
        actual: kind === 'deleted' ? null : { ...fingerprint, sha256: 'b'.repeat(64) },
        disk: kind === 'deleted' ? undefined : {
          path: kind === 'renamed' ? 'C:\\notes\\renamed.md' : 'C:\\notes\\one.md',
          name: kind === 'renamed' ? 'renamed.md' : 'one.md',
          content: 'disk text',
          lineEnding: 'LF',
          modifiedAt: 2,
          fingerprint: { ...fingerprint, sha256: 'b'.repeat(64) },
        },
      },
    },
  };
}

const restoreItems: RestorePlanItem[] = [
  {
    id: 'one',
    path: 'C:\\notes\\one.md',
    name: 'one.md',
    mode: 'source',
    active: true,
    source: 'snapshot',
    snapshot: {
      version: 1,
      snapshotId: 'snapshot-one',
      id: 'one',
      content: 'unsaved',
      reason: 'autosave',
      createdAt: 1,
      updatedAt: 2,
    },
  },
  {
    id: 'two',
    path: 'C:\\notes\\two.md',
    name: 'two.md',
    mode: 'structured',
    active: false,
    source: 'disk',
  },
];

describe('ConflictDialog', () => {
  it('offers every required resolution and compares editor with disk text', () => {
    render(<ConflictDialog open conflict={conflict()} onResolve={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reload from disk' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Keep editor version' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save a copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Overwrite disk version…' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    const comparison = screen.getByRole('region', { name: 'Editor and disk comparison' });
    expect(comparison).toHaveTextContent('editor text');
    expect(comparison).toHaveTextContent('disk text');
  });

  it('routes actions to the shared conflict resolver', async () => {
    const onResolve = vi.fn(async () => undefined);
    render(<ConflictDialog open conflict={conflict()} onResolve={onResolve} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('reload'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editor version' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('keep'));
  });

  it('requires a second explicit action before overwrite', async () => {
    const onResolve = vi.fn(async () => undefined);
    render(<ConflictDialog open conflict={conflict()} onResolve={onResolve} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite disk version…' }));
    expect(onResolve).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog', { name: 'Confirm overwrite' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm overwrite' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('overwrite'));
  });

  it('disables reload after deletion and reports action failures', async () => {
    const onResolve = vi.fn(async () => { throw new Error('Snapshot destination is read-only'); });
    render(<ConflictDialog open conflict={conflict('deleted')} onResolve={onResolve} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reload from disk' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editor version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('read-only');
  });
});

describe('RecoveryCenterDialog', () => {
  it('selects all recoverable tabs and restores only the user selection', async () => {
    const onRestore = vi.fn(async () => undefined);
    render(<RecoveryCenterDialog open items={restoreItems} onRestore={onRestore} onDiscard={vi.fn()} onClose={vi.fn()} />);
    const second = screen.getByRole('checkbox', { name: /two\.md/i });
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith([restoreItems[0]]));
  });

  it('requires selection and explicitly discards selected recovery entries', async () => {
    const onDiscard = vi.fn(async () => undefined);
    render(<RecoveryCenterDialog open items={restoreItems} onRestore={vi.fn()} onDiscard={onDiscard} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard selected' }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith(restoreItems));
  });

  it('closes on Escape without discarding or restoring anything', () => {
    const onClose = vi.fn();
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(<RecoveryCenterDialog open items={restoreItems} onRestore={onRestore} onDiscard={onDiscard} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Restore previous session' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
