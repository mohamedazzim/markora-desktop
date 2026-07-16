import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  MemoryShortcutPersistence,
  ShortcutDispatcher,
  ShortcutManager,
  ShortcutRecorder,
  normalizeShortcut,
  shortcutStrokeFromKeyboardEvent,
  type CommandDefinition,
} from '../../src/renderer/commands';

interface Context {
  readonly name: string;
}

const command = (
  id: string,
  shortcut: string | undefined,
  handler = vi.fn(),
): CommandDefinition<Context> => ({
  id,
  label: id,
  category: 'Test',
  defaultShortcut: shortcut,
  enabled: true,
  handler,
});

function registryWithDefaults() {
  const registry = new CommandRegistry<Context>(() => ({ name: 'provider' }));
  registry.registerMany([
    command('command.alpha', 'Ctrl+A'),
    command('command.beta', 'Ctrl+B'),
    command('command.gamma', undefined),
  ]);
  return registry;
}

describe('shortcut normalization and recording', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ['shift+control+p', 'Ctrl+Shift+P'],
    ['cmd+option+z', 'Alt+Meta+Z'],
    ['Ctrl+K ctrl+z', 'Ctrl+K Ctrl+Z'],
    ['ctrl+plus', 'Ctrl+Plus'],
    ['esc', 'Escape'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeShortcut(input)).toBe(expected);
  });

  it.each(['', 'Ctrl', 'Ctrl++', 'Ctrl+A+B', 'Ctrl+K Z X Q R'])('rejects invalid shortcut %s', (input) => {
    expect(() => normalizeShortcut(input)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SHORTCUT' }),
    );
  });

  it('records a two-stroke chord and completes it without browser handling', () => {
    const completed = vi.fn();
    const recorder = new ShortcutRecorder({ onComplete: completed, maximumStrokes: 2 });
    const first = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    const second = new KeyboardEvent('keydown', { key: 'z', cancelable: true });

    expect(recorder.handleKeyDown(first)).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    expect(recorder.value).toBe('Ctrl+K');
    recorder.handleKeyDown(second);

    expect(completed).toHaveBeenCalledWith('Ctrl+K Z');
  });

  it('completes a single recorded stroke after the chord timeout and supports cancellation', () => {
    const completed = vi.fn();
    const cancelled = vi.fn();
    const recorder = new ShortcutRecorder({
      chordTimeoutMs: 250,
      onComplete: completed,
      onCancel: cancelled,
    });
    recorder.handleKeyDown(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    vi.advanceTimersByTime(250);
    expect(completed).toHaveBeenCalledWith('Ctrl+S');

    recorder.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(recorder.value).toBe('');
  });

  it('normalizes browser keyboard events and ignores modifiers/composition', () => {
    expect(
      shortcutStrokeFromKeyboardEvent({
        key: 'p',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe('Ctrl+Shift+P');
    expect(
      shortcutStrokeFromKeyboardEvent({
        key: 'Control',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing: false,
      }),
    ).toBeNull();
  });
});

describe('ShortcutManager', () => {
  it('detects conflicts and supports reject, replace, and swap resolution', () => {
    const manager = new ShortcutManager(registryWithDefaults());
    expect(manager.conflictsFor('control+a', 'command.beta')).toEqual(['command.alpha']);
    expect(() => manager.assign('command.beta', 'Ctrl+A')).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', conflicts: ['command.alpha'] }),
    );

    manager.assign('command.beta', 'Ctrl+A', 'replace');
    expect(manager.bindingFor('command.alpha')).toBeNull();
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+A');

    manager.resetAll();
    manager.assign('command.beta', 'Ctrl+A', 'swap');
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+B');
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+A');
  });

  it('clears and resets one binding or all bindings', () => {
    const manager = new ShortcutManager(registryWithDefaults());
    manager.clear('command.alpha');
    manager.assign('command.gamma', 'Ctrl+G');
    expect(manager.bindingFor('command.alpha')).toBeNull();
    expect(manager.bindingFor('command.gamma')).toBe('Ctrl+G');

    manager.reset('command.alpha');
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+A');
    manager.resetAll();
    expect(manager.bindingFor('command.gamma')).toBeNull();
  });

  it('persists transactionally and reloads a versioned settings payload', () => {
    const persistence = new MemoryShortcutPersistence();
    const first = new ShortcutManager(registryWithDefaults(), persistence);
    first.assign('command.gamma', 'Ctrl+Shift+G');
    first.clear('command.alpha');

    const exported = JSON.parse(first.exportSettings()) as Record<string, unknown>;
    expect(exported).toMatchObject({ schema: 'markora.shortcuts', version: 2 });

    const second = new ShortcutManager(registryWithDefaults(), persistence);
    expect(second.load()).toMatchObject({ migratedFrom: 2 });
    expect(second.bindingFor('command.gamma')).toBe('Ctrl+Shift+G');
    expect(second.bindingFor('command.alpha')).toBeNull();
  });

  it('migrates v1 and unversioned files, normalizes bindings, and reports unknown commands', () => {
    const manager = new ShortcutManager(registryWithDefaults());
    const v1 = manager.importSettings(
      JSON.stringify({
        version: 1,
        shortcuts: { 'command.alpha': 'shift+ctrl+x', 'retired.command': 'Ctrl+R' },
      }),
    );
    expect(v1).toEqual({
      migratedFrom: 1,
      importedCommandIds: ['command.alpha'],
      ignoredCommandIds: ['retired.command'],
    });
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+Shift+X');

    expect(manager.importSettings(JSON.stringify({ 'command.gamma': 'alt+g' }))).toMatchObject({
      migratedFrom: 0,
    });
    expect(manager.bindingFor('command.gamma')).toBe('Alt+G');
  });

  it('rejects malformed, unsupported, and conflicting imports or resolves conflicts explicitly', () => {
    const manager = new ShortcutManager(registryWithDefaults());
    expect(() => manager.importSettings('{bad json')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SETTINGS' }),
    );
    expect(() => manager.importSettings(JSON.stringify({ version: 99, bindings: {} }))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }),
    );
    const conflict = JSON.stringify({
      schema: 'markora.shortcuts',
      version: 2,
      bindings: { 'command.alpha': 'Ctrl+X', 'command.beta': 'Ctrl+X' },
    });
    expect(() => manager.importSettings(conflict)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    manager.importSettings(conflict, 'replace');
    expect(manager.bindingFor('command.alpha')).toBeNull();
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+X');
  });

  it('does not commit state when persistence fails', () => {
    const manager = new ShortcutManager(registryWithDefaults(), {
      load: () => null,
      save: () => {
        throw new Error('disk full');
      },
    });
    expect(() => manager.assign('command.gamma', 'Ctrl+G')).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED' }),
    );
    expect(manager.bindingFor('command.gamma')).toBeNull();
  });
});

describe('ShortcutDispatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('executes single strokes and multi-key chords through the command registry', async () => {
    const single = vi.fn();
    const chord = vi.fn();
    const registry = new CommandRegistry<Context>(() => ({ name: 'provider' }));
    registry.registerMany([command('file.save', 'Ctrl+S', single), command('view.zen', 'Ctrl+K Z', chord)]);
    const dispatcher = new ShortcutDispatcher(new ShortcutManager(registry));

    const save = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    expect(dispatcher.handleKeyDown(save)).toBe(true);
    expect(save.defaultPrevented).toBe(true);

    const prefix = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    const suffix = new KeyboardEvent('keydown', { key: 'z', cancelable: true });
    expect(dispatcher.handleKeyDown(prefix)).toBe(true);
    expect(dispatcher.pendingChord).toBe('Ctrl+K');
    expect(dispatcher.handleKeyDown(suffix)).toBe(true);
    expect(dispatcher.pendingChord).toBeNull();
    await Promise.resolve();

    expect(single).toHaveBeenCalledTimes(1);
    expect(chord).toHaveBeenCalledTimes(1);
  });

  it('expires an incomplete chord and does not hijack plain typing in editable controls', () => {
    const registry = new CommandRegistry<Context>();
    registry.register(command('view.zen', 'Ctrl+K Z'));
    registry.register(command('navigation.next', 'J'));
    const dispatcher = new ShortcutDispatcher(new ShortcutManager(registry), {
      chordTimeoutMs: 250,
    });

    dispatcher.handleKeyDown(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(dispatcher.pendingChord).toBe('Ctrl+K');
    vi.advanceTimersByTime(250);
    expect(dispatcher.pendingChord).toBeNull();

    const input = document.createElement('input');
    const typing = new KeyboardEvent('keydown', { key: 'j', cancelable: true });
    Object.defineProperty(typing, 'target', { value: input });
    expect(dispatcher.handleKeyDown(typing)).toBe(false);
    expect(typing.defaultPrevented).toBe(false);
  });
});
