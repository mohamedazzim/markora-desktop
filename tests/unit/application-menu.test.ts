import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildApplicationMenuTemplate } from '../../electron/main/application-menu';
import {
  APPLICATION_COMMAND_IDS,
  isApplicationCommandId,
  type ApplicationCommandId,
} from '../../src/shared/application-commands';

function children(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return Array.isArray(item.submenu) ? item.submenu : [];
}

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...flatten(children(item))]);
}

describe('native application menu', () => {
  it('accepts only the stable shared command allowlist', () => {
    expect(APPLICATION_COMMAND_IDS.length).toBe(new Set(APPLICATION_COMMAND_IDS).size);
    expect(
      APPLICATION_COMMAND_IDS.every((id) => /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u.test(id)),
    ).toBe(true);
    expect(isApplicationCommandId('file.save')).toBe(true);
    expect(isApplicationCommandId('view.toggleZenMode')).toBe(true);
    expect(isApplicationCommandId('window.reload')).toBe(false);
    expect(isApplicationCommandId({ id: 'file.save' })).toBe(false);
  });

  it('builds an accessible packaged menu whose commands have one renderer execution path', () => {
    const dispatchCommand = vi.fn<(id: ApplicationCommandId) => void>();
    const template = buildApplicationMenuTemplate({ isPackaged: true, dispatchCommand });
    const items = flatten(template);

    expect(template.map((item) => item.label)).toEqual([
      '&File',
      '&Edit',
      '&Paragraph',
      'F&ormat',
      '&View',
      '&Themes',
      '&Help',
    ]);
    expect(items.filter((item) => item.type !== 'separator').every((item) => Boolean(item.label))).toBe(true);

    const commandItems = items.filter((item) => typeof item.click === 'function');
    expect(commandItems.length).toBeGreaterThan(30);
    expect(commandItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'theme.white',
        'editor.setParagraph',
        'editor.setHeading1',
        'editor.setHeading2',
        'editor.setHeading3',
        'editor.setHeading4',
        'editor.setHeading5',
        'editor.setHeading6',
      ]),
    );
    for (const item of commandItems) {
      expect(item.accelerator).toBeUndefined();
      expect(isApplicationCommandId(item.id)).toBe(true);
      (item.click as () => void)();
    }
    expect(dispatchCommand).toHaveBeenCalledTimes(commandItems.length);
    expect(dispatchCommand.mock.calls.every(([id]) => isApplicationCommandId(id))).toBe(true);

    const roles = items.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(['cut', 'copy', 'paste', 'delete', 'selectAll']);
    expect(roles).not.toContain('close');
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('toggleDevTools');
  });

  it('adds reload and developer tools only to development menus', () => {
    const template = buildApplicationMenuTemplate({ isPackaged: false, dispatchCommand: vi.fn() });
    const items = flatten(template);
    expect(template.at(-1)?.label).toBe('&Developer');
    expect(items.map((item) => item.role)).toEqual(
      expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']),
    );
  });
});
