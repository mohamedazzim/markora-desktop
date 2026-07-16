import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandPalette,
  CommandRegistry,
  MemoryShortcutPersistence,
  ShortcutManager,
  commandMatchScore,
  filterPaletteCommands,
  type CommandDefinition,
} from '../../src/renderer/commands';

interface Context {
  readonly canExport: boolean;
}

const command = (
  id: string,
  label: string,
  handler: CommandDefinition<Context>['handler'] = vi.fn(),
  enabled: CommandDefinition<Context>['enabled'] = true,
  shortcut?: string,
): CommandDefinition<Context> => ({
  id,
  label,
  category: id.startsWith('file') ? 'File' : 'Export',
  handler,
  enabled,
  defaultShortcut: shortcut,
});

function paletteRegistry() {
  const registry = new CommandRegistry<Context>();
  registry.registerMany([
    command('file.new', 'New Document'),
    command('file.open', 'Open File'),
    command('file.save', 'Save Document', vi.fn(), true, 'Ctrl+S'),
    command('export.pdf', 'Export PDF', vi.fn(), (context) => context.canExport),
  ]);
  return registry;
}

describe('command palette filtering', () => {
  it('scores exact/prefix matches above fuzzy subsequences and searches identifiers', () => {
    const save = command('file.save', 'Save Document');
    expect(commandMatchScore(save, 'Save Document')).toBeGreaterThan(commandMatchScore(save, 'svd')!);
    expect(commandMatchScore(save, 'file save')).not.toBeNull();
    expect(commandMatchScore(save, 'unrelated')).toBeNull();
  });

  it('sorts enabled matches before disabled ones', () => {
    const registry = paletteRegistry();
    const matches = filterPaletteCommands(registry, '', { canExport: false });
    expect(matches.at(-1)).toMatchObject({ command: { id: 'export.pdf' }, enabled: false });
  });
});

describe('CommandPalette accessibility and interaction', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('exposes dialog/combobox/listbox semantics, result announcements, and shortcuts', () => {
    const registry = paletteRegistry();
    const shortcuts = new ShortcutManager(registry, new MemoryShortcutPersistence());
    render(
      <CommandPalette
        open
        registry={registry}
        context={{ canExport: true }}
        shortcuts={shortcuts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Command Palette' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveFocus();
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('4 commands found');
    expect(screen.getByText('Ctrl+S', { selector: 'kbd' })).toBeInTheDocument();
  });

  it('searches, navigates, and executes the selected command through the registry', async () => {
    const registry = paletteRegistry();
    const save = registry.require('file.save').handler as ReturnType<typeof vi.fn>;
    const onClose = vi.fn();
    render(<CommandPalette open registry={registry} context={{ canExport: true }} onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: 'save doc' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('skips disabled commands and reports their state to assistive technology', () => {
    const registry = paletteRegistry();
    const exportHandler = registry.require('export.pdf').handler as ReturnType<typeof vi.fn>;
    render(<CommandPalette open registry={registry} context={{ canExport: false }} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Export PDF' } });
    const option = screen.getByRole('option', { name: /Export PDF/ });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(exportHandler).not.toHaveBeenCalled();
  });

  it('supports Arrow keys and Escape without moving DOM focus away from search', () => {
    const registry = paletteRegistry();
    const onClose = vi.fn();
    render(<CommandPalette open registry={registry} context={{ canExport: true }} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    const firstActive = input.getAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).not.toBe(firstActive);
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside and restores the previously focused control on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open commands';
    document.body.append(trigger);
    trigger.focus();
    const registry = paletteRegistry();
    const view = render(
      <CommandPalette open registry={registry} context={{ canExport: true }} onClose={vi.fn()} />,
    );
    const input = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');
    const last = options.at(-1)!;

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    view.rerender(
      <CommandPalette open={false} registry={registry} context={{ canExport: true }} onClose={vi.fn()} />,
    );
    await act(async () => Promise.resolve());
    expect(trigger).toHaveFocus();
  });

  it('surfaces handler failures without closing the palette', async () => {
    const registry = new CommandRegistry<Context>();
    registry.register(
      command('file.fail', 'Fail Command', () => Promise.reject(new Error('expected failure'))),
    );
    const onClose = vi.fn();
    const onExecutionError = vi.fn();
    render(
      <CommandPalette
        open
        registry={registry}
        context={{ canExport: true }}
        onClose={onClose}
        onExecutionError={onExecutionError}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    await waitFor(() => expect(onExecutionError).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
