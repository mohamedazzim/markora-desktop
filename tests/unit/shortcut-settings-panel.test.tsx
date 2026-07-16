import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  ShortcutManager,
  ShortcutSettingsPanel,
  type CommandDefinition,
} from '../../src/renderer/commands';

const command = (id: string, label: string, shortcut?: string): CommandDefinition<void> => ({
  id,
  label,
  category: id.startsWith('file') ? 'File' : 'View',
  defaultShortcut: shortcut,
  enabled: true,
  handler: vi.fn(),
});

function shortcutManager() {
  const registry = new CommandRegistry<void>();
  registry.registerMany([
    command('command.alpha', 'Alpha Command', 'Ctrl+A'),
    command('command.beta', 'Beta Command', 'Ctrl+B'),
    command('command.gamma', 'Gamma Command'),
  ]);
  return new ShortcutManager(registry);
}

describe('ShortcutSettingsPanel', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders an accessible searchable command list with current bindings', () => {
    const manager = shortcutManager();
    render(<ShortcutSettingsPanel manager={manager} />);

    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Configurable shortcuts' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByLabelText('Current shortcut: Ctrl+A')).toHaveTextContent('Ctrl+A');
    expect(screen.getByLabelText('Current shortcut: Unassigned')).toHaveTextContent('Unassigned');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search commands' }), {
      target: { value: 'beta' },
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Beta Command', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('1 command')).toBeInTheDocument();
  });

  it('records single-stroke and multi-key shortcuts with live announcements', () => {
    vi.useFakeTimers();
    const manager = shortcutManager();
    render(<ShortcutSettingsPanel manager={manager} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record shortcut for Alpha Command' }));
    const alphaRecorder = screen.getByRole('button', {
      name: /Recording shortcut for Alpha Command/,
    });
    expect(alphaRecorder).toHaveFocus();
    fireEvent.keyDown(alphaRecorder, { key: 'x', ctrlKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('Ctrl+X');
    act(() => vi.advanceTimersByTime(1_200));
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+X');
    expect(screen.getByRole('status')).toHaveTextContent('Alpha Command is now assigned to Ctrl+X');

    fireEvent.click(screen.getByRole('button', { name: 'Record shortcut for Gamma Command' }));
    const gammaRecorder = screen.getByRole('button', {
      name: /Recording shortcut for Gamma Command/,
    });
    fireEvent.keyDown(gammaRecorder, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(gammaRecorder, { key: 'z' });
    expect(manager.bindingFor('command.gamma')).toBe('Ctrl+K Z');
  });

  it('can reject or replace a recorded shortcut conflict', () => {
    vi.useFakeTimers();
    const manager = shortcutManager();
    render(<ShortcutSettingsPanel manager={manager} />);

    const recordConflict = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record shortcut for Beta Command' }));
      const recorder = screen.getByRole('button', { name: /Recording shortcut for Beta Command/ });
      fireEvent.keyDown(recorder, { key: 'a', ctrlKey: true });
      act(() => vi.advanceTimersByTime(1_200));
    };

    recordConflict();
    const firstDialog = screen.getByRole('alertdialog', { name: 'Shortcut conflict' });
    expect(firstDialog).toHaveTextContent('Alpha Command');
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Keep existing' }));
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+A');
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+B');

    recordConflict();
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Shortcut conflict' })).getByRole('button', {
        name: 'Replace existing',
      }),
    );
    expect(manager.bindingFor('command.alpha')).toBeNull();
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+A');
  });

  it('swaps a conflicting shortcut with the command’s previous binding', () => {
    vi.useFakeTimers();
    const manager = shortcutManager();
    render(<ShortcutSettingsPanel manager={manager} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record shortcut for Beta Command' }));
    const recorder = screen.getByRole('button', { name: /Recording shortcut for Beta Command/ });
    fireEvent.keyDown(recorder, { key: 'a', ctrlKey: true });
    act(() => vi.advanceTimersByTime(1_200));
    const dialog = screen.getByRole('alertdialog', { name: 'Shortcut conflict' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Swap shortcuts' }));

    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+B');
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+A');
  });

  it('resets one command and confirms resetting all commands', () => {
    const manager = shortcutManager();
    manager.assign('command.alpha', 'Ctrl+X');
    manager.assign('command.gamma', 'Ctrl+G');
    render(<ShortcutSettingsPanel manager={manager} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset Alpha Command' }));
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+A');
    expect(manager.bindingFor('command.gamma')).toBe('Ctrl+G');

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reset every shortcut?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset all shortcuts' }));
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+A');
    expect(manager.bindingFor('command.gamma')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('All shortcuts were reset');
  });

  it('imports pasted JSON, imports through a host callback, and exports versioned JSON', async () => {
    const manager = shortcutManager();
    const uploaded = JSON.stringify({
      schema: 'markora.shortcuts',
      version: 2,
      bindings: { 'command.alpha': 'Ctrl+X' },
    });
    const onRequestImport = vi.fn(async () => uploaded);
    const onExport = vi.fn<(serialized: string, fileName: string) => Promise<void>>();
    onExport.mockResolvedValue(undefined);
    render(<ShortcutSettingsPanel manager={manager} onRequestImport={onRequestImport} onExport={onExport} />);

    const pasted = JSON.stringify({ version: 1, shortcuts: { 'command.gamma': 'alt+g' } });
    fireEvent.change(screen.getByLabelText('Paste shortcut settings JSON'), {
      target: { value: pasted },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import pasted JSON' }));
    expect(manager.bindingFor('command.gamma')).toBe('Alt+G');

    fireEvent.click(screen.getByRole('button', { name: 'Import file…' }));
    await waitFor(() => expect(onRequestImport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(manager.bindingFor('command.alpha')).toBe('Ctrl+X'));

    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const [serialized, fileName] = onExport.mock.calls[0];
    expect(JSON.parse(serialized)).toMatchObject({ schema: 'markora.shortcuts', version: 2 });
    expect(fileName).toBe('markora-shortcuts.json');
  });

  it('previews import conflicts and requires explicit replacement', () => {
    const manager = shortcutManager();
    render(<ShortcutSettingsPanel manager={manager} />);
    const conflict = JSON.stringify({
      schema: 'markora.shortcuts',
      version: 2,
      bindings: { 'command.alpha': 'Ctrl+X', 'command.beta': 'Ctrl+X' },
    });
    fireEvent.change(screen.getByLabelText('Paste shortcut settings JSON'), {
      target: { value: conflict },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import pasted JSON' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Import conflicts' });
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+A');
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+B');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace conflicts' }));
    expect(manager.bindingFor('command.alpha')).toBeNull();
    expect(manager.bindingFor('command.beta')).toBe('Ctrl+X');
  });

  it('announces import/export failures and leaves existing settings intact', async () => {
    const manager = shortcutManager();
    const onRequestImport = vi.fn(async () => {
      throw new Error('File picker failed');
    });
    render(<ShortcutSettingsPanel manager={manager} onRequestImport={onRequestImport} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import file…' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('File picker failed'));
    expect(screen.getByRole('status')).toHaveTextContent('Shortcut import failed');
    expect(manager.bindingFor('command.alpha')).toBe('Ctrl+A');
  });
});
