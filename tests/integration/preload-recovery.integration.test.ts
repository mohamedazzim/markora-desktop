import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkoraApi } from '../../src/shared/contracts';
import { APPLICATION_COMMAND_IDS } from '../../src/shared/application-commands';

const electronMocks = vi.hoisted(() => ({
  listeners: new Map<string, (...arguments_: unknown[]) => void>(),
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

electronMocks.on.mockImplementation((channel: string, listener: (...arguments_: unknown[]) => void) => {
  electronMocks.listeners.set(channel, listener);
  return electronMocks.on;
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.expose },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

let api: MarkoraApi;
let preloadApplicationCommandIds: readonly string[];

beforeAll(async () => {
  const preload = await import('../../electron/preload/index');
  preloadApplicationCommandIds = preload.PRELOAD_APPLICATION_COMMAND_IDS;
  api = electronMocks.expose.mock.calls[0][1] as MarkoraApi;
});

beforeEach(() => {
  electronMocks.invoke.mockReset();
  electronMocks.on.mockClear();
  electronMocks.removeListener.mockClear();
});

describe('sandboxed preload event bridge', () => {
  it('keeps its self-contained runtime command allowlist in parity with shared command IDs', () => {
    expect(preloadApplicationCommandIds).toEqual(APPLICATION_COMMAND_IDS);
  });

  it('exposes one typed Markora API through contextBridge', () => {
    expect(electronMocks.expose).toHaveBeenCalledTimes(1);
    expect(electronMocks.expose).toHaveBeenCalledWith('markora', expect.any(Object));
    expect(typeof api.saveFileChecked).toBe('function');
    expect(typeof api.onExternalFileChange).toBe('function');
    expect(typeof api.onCommand).toBe('function');
    expect(api).not.toHaveProperty('exportDocument');
    expect(api).not.toHaveProperty('searchWorkspace');
  });

  it('forwards only allowlisted native-menu commands', () => {
    const listener = electronMocks.listeners.get('app:command');
    expect(listener).toBeTypeOf('function');

    listener!({}, 'window.reload');
    listener!({}, { id: 'file.open' });
    listener!({}, 'file.save');

    const callback = vi.fn();
    const unsubscribe = api.onCommand(callback);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('file.save');

    listener!({}, 'file.open');

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith('file.open');
    unsubscribe();

    listener!({}, 'file.close');
    listener!({}, 'window.reload');
    expect(callback).toHaveBeenCalledTimes(2);
    const drain = vi.fn();
    api.onCommand(drain)();
    expect(drain).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledWith('file.close');
  });

  it('delivers each buffered command once to the first renderer subscriber', () => {
    const listener = electronMocks.listeners.get('app:command');
    expect(listener).toBeTypeOf('function');

    listener!({}, 'file.new');
    listener!({}, 'editor.find');

    const first = vi.fn();
    const unsubscribeFirst = api.onCommand(first);
    expect(first.mock.calls.map(([id]) => id)).toEqual(['file.new', 'editor.find']);

    const second = vi.fn();
    const unsubscribeSecond = api.onCommand(second);
    expect(second).not.toHaveBeenCalled();

    listener!({}, 'view.toggleZenMode');
    expect(first).toHaveBeenLastCalledWith('view.toggleZenMode');
    expect(second).toHaveBeenLastCalledWith('view.toggleZenMode');

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('forwards checked saves and explicit version acceptance on fixed channels', async () => {
    const request = { path: 'C:\\notes\\one.md', content: 'editor' };
    await api.saveFileChecked(request);
    expect(electronMocks.invoke).toHaveBeenCalledWith('file:saveChecked', request);
    const accepted = { path: request.path, fingerprint: { modifiedAt: 1, size: 4, sha256: 'a'.repeat(64) } };
    await api.acceptDiskVersion(accepted);
    expect(electronMocks.invoke).toHaveBeenCalledWith('file:acceptDiskVersion', accepted);
  });

  it('forwards recovery snapshots, history, and session operations', async () => {
    const snapshot = { id: 'doc', content: 'unsaved', reason: 'autosave' as const };
    await api.saveRecovery(snapshot);
    await api.getRecoveryHistory('doc');
    const session = {
      documents: [{ id: 'doc', name: 'Untitled.md', mode: 'source' as const, active: true }],
    };
    await api.saveRecoverySession(session);
    await api.loadRecoverySession();
    expect(electronMocks.invoke.mock.calls).toEqual(
      expect.arrayContaining([
        ['recovery:save', snapshot],
        ['recovery:history', 'doc'],
        ['recovery:sessionSave', session],
        ['recovery:sessionLoad'],
      ]),
    );
  });

  it('subscribes and unsubscribes typed external change events', () => {
    const callback = vi.fn();
    const unsubscribe = api.onExternalFileChange(callback);
    expect(electronMocks.on).toHaveBeenCalledWith('file:externalChanged', expect.any(Function));
    const listener = electronMocks.on.mock.calls.at(-1)![1] as (...arguments_: unknown[]) => void;
    const event = {
      kind: 'deleted',
      path: 'C:\\notes\\gone.md',
      previousFingerprint: { modifiedAt: 1, size: 4, sha256: 'a'.repeat(64) },
      fingerprint: null,
      observedAt: 2,
    };
    listener({}, event);
    expect(callback).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(electronMocks.removeListener).toHaveBeenCalledWith('file:externalChanged', listener);
  });

  it('keeps the compatibility modified-file listener isolated', () => {
    const callback = vi.fn();
    const unsubscribe = api.onExternalChange(callback);
    expect(electronMocks.on).toHaveBeenCalledWith('file:changed', expect.any(Function));
    unsubscribe();
    expect(electronMocks.removeListener).toHaveBeenCalledWith('file:changed', expect.any(Function));
  });
});
