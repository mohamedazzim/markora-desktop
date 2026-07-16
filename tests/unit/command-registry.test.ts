import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_COMMAND_IDS,
  BASELINE_COMMAND_METADATA,
  CommandRegistry,
  CommandRegistryError,
  ShortcutManager,
  createBaselineCommandDefinitions,
  type BaselineCommandHandlers,
  type CommandDefinition,
} from '../../src/renderer/commands';

interface TestContext {
  readonly hasDocument: boolean;
}

const definition = (
  id: string,
  handler = vi.fn(),
  enabled: CommandDefinition<TestContext>['enabled'] = true,
): CommandDefinition<TestContext> => ({
  id,
  label: id,
  category: 'Test',
  handler,
  enabled,
});

describe('CommandRegistry', () => {
  it('uses one handler and enabled-state boundary for every caller', async () => {
    const context: TestContext = { hasDocument: true };
    const handler = vi.fn(({ args, context: received }) => ({ args, received }));
    const registry = new CommandRegistry(() => context);
    registry.register(definition('file.save', handler, (value) => value.hasDocument));

    await expect(registry.execute('file.save', { origin: 'toolbar' })).resolves.toEqual({
      args: { origin: 'toolbar' },
      received: context,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(registry.isEnabled('file.save')).toBe(true);
    expect(registry.snapshot()).toMatchObject([{ id: 'file.save', enabled: true }]);
  });

  it('blocks disabled commands before their handlers run', async () => {
    const handler = vi.fn();
    const registry = new CommandRegistry<TestContext>();
    registry.register(definition('file.save', handler, (context) => context.hasDocument));

    await expect(registry.execute('file.save', undefined, { hasDocument: false })).rejects.toMatchObject({
      code: 'DISABLED_COMMAND',
      commandId: 'file.save',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('validates stable identifiers and rejects duplicates and unknown commands', async () => {
    const registry = new CommandRegistry<TestContext>();
    expect(() => registry.register(definition('Save File'))).toThrowError(CommandRegistryError);
    registry.register(definition('file.save'));
    expect(() => registry.register(definition('file.save'))).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_COMMAND' }),
    );
    await expect(registry.execute('file.missing', undefined, { hasDocument: true })).rejects.toMatchObject({
      code: 'UNKNOWN_COMMAND',
    });
  });

  it('rolls back registerMany when one definition is invalid', () => {
    const registry = new CommandRegistry<TestContext>();
    expect(() => registry.registerMany([definition('file.open'), definition('invalid command')])).toThrow();
    expect(registry.list()).toHaveLength(0);
  });

  it('publishes registration changes and returned disposers are idempotent', () => {
    const registry = new CommandRegistry<TestContext>();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const dispose = registry.register(definition('file.open'));
    dispose();
    dispose();
    unsubscribe();

    expect(listener.mock.calls.map(([change]) => change)).toEqual([
      { type: 'registered', id: 'file.open' },
      { type: 'unregistered', id: 'file.open' },
    ]);
  });
});

describe('baseline command definitions', () => {
  it('contains every required stable identifier exactly once with complete metadata', () => {
    const required = [
      'file.new',
      'file.open',
      'file.openFolder',
      'file.save',
      'file.saveAs',
      'file.close',
      'editor.undo',
      'editor.redo',
      'editor.toggleBold',
      'editor.toggleItalic',
      'editor.toggleStrike',
      'editor.toggleUnderline',
      'editor.toggleHighlight',
      'editor.editLink',
      'editor.setParagraph',
      'editor.setHeading1',
      'editor.setHeading2',
      'editor.setHeading3',
      'editor.setHeading4',
      'editor.setHeading5',
      'editor.setHeading6',
      'editor.toggleBulletList',
      'editor.toggleOrderedList',
      'editor.toggleTaskList',
      'editor.toggleBlockquote',
      'editor.toggleCodeBlock',
      'editor.toggleSourceMode',
      'editor.insertTable',
      'editor.insertImage',
      'editor.insertMath',
      'editor.insertMermaid',
      'editor.find',
      'editor.replace',
      'table.addRowBefore',
      'table.addRowAfter',
      'table.addColumnBefore',
      'table.addColumnAfter',
      'table.deleteRow',
      'table.deleteColumn',
      'table.copyMarkdown',
      'table.copyTsv',
      'table.delete',
      'view.toggleFocusMode',
      'view.toggleTypewriterMode',
      'view.toggleZenMode',
      'view.toggleOutline',
      'export.html',
      'export.pdf',
      'export.pandoc',
    ];
    const ids = BASELINE_COMMAND_METADATA.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(BASELINE_COMMAND_IDS);
    required.forEach((id) => expect(ids).toContain(id));
    BASELINE_COMMAND_METADATA.forEach((command) => {
      expect(command.label.trim()).not.toBe('');
      expect(command.category.trim()).not.toBe('');
    });
  });

  it('attaches supplied real handlers and enabled states to all metadata', async () => {
    const calls: string[] = [];
    const handlers = Object.fromEntries(
      BASELINE_COMMAND_IDS.map((id) => [id, () => calls.push(id)]),
    ) as unknown as BaselineCommandHandlers<TestContext>;
    const definitions = createBaselineCommandDefinitions(handlers, {
      'file.save': (context) => context.hasDocument,
    });
    const registry = new CommandRegistry<TestContext>();
    registry.registerMany(definitions);

    await registry.execute('file.new', undefined, { hasDocument: false });
    await expect(registry.execute('file.save', undefined, { hasDocument: false })).rejects.toMatchObject({
      code: 'DISABLED_COMMAND',
    });
    expect(calls).toEqual(['file.new']);
  });

  it('ships conflict-free formatting shortcuts and contextual table enabled states', () => {
    const handlers = Object.fromEntries(
      BASELINE_COMMAND_IDS.map((id) => [id, vi.fn()]),
    ) as unknown as BaselineCommandHandlers<TestContext>;
    const definitions = createBaselineCommandDefinitions(handlers, {
      'table.delete': (context) => context.hasDocument,
    });
    const registry = new CommandRegistry<TestContext>();
    registry.registerMany(definitions);

    expect(() => new ShortcutManager(registry)).not.toThrow();
    expect(registry.require('editor.editLink').defaultShortcut).toBe('Ctrl+K');
    expect(registry.require('editor.insertMath').menu).toMatchObject({ menu: 'insert' });
    expect(registry.isEnabled('table.delete', { hasDocument: false })).toBe(false);
    expect(registry.isEnabled('table.delete', { hasDocument: true })).toBe(true);
  });

  it('fails instead of installing a placeholder when a baseline handler is missing', () => {
    const incomplete = {} as BaselineCommandHandlers<TestContext>;
    expect(() => createBaselineCommandDefinitions(incomplete)).toThrow(/real handler/i);
  });
});
