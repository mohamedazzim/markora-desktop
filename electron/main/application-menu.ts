import type { MenuItemConstructorOptions } from 'electron';
import { isApplicationCommandId, type ApplicationCommandId } from '../../src/shared/application-commands';

export interface ApplicationMenuOptions {
  readonly isPackaged: boolean;
  readonly dispatchCommand: (id: ApplicationCommandId) => void;
}

function commandItem(
  label: string,
  id: ApplicationCommandId,
  dispatchCommand: ApplicationMenuOptions['dispatchCommand'],
): MenuItemConstructorOptions {
  if (!isApplicationCommandId(id)) throw new Error(`Invalid application-menu command: ${id}`);
  return {
    id,
    label,
    click: () => dispatchCommand(id),
  };
}

const separator = (): MenuItemConstructorOptions => ({ type: 'separator' });

/**
 * Builds the explicit native menu without command accelerators. Configurable shortcuts are dispatched
 * in the renderer, so a native accelerator must never become a second execution path for a registry
 * command. Native edit roles remain available for operations that have no Markora command identifier.
 */
export function buildApplicationMenuTemplate({
  isPackaged,
  dispatchCommand,
}: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const command = (label: string, id: ApplicationCommandId) => commandItem(label, id, dispatchCommand);

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        command('&New Document', 'file.new'),
        command('&Open File…', 'file.open'),
        command('Open &Folder…', 'file.openFolder'),
        separator(),
        command('&Save', 'file.save'),
        command('Save &As…', 'file.saveAs'),
        separator(),
        command('&Close Document', 'file.close'),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        command('&Undo', 'editor.undo'),
        command('&Redo', 'editor.redo'),
        separator(),
        { label: 'Cu&t', role: 'cut' },
        { label: '&Copy', role: 'copy' },
        { label: '&Paste', role: 'paste' },
        { label: '&Delete', role: 'delete' },
        separator(),
        { label: 'Select &All', role: 'selectAll' },
        separator(),
        command('&Find…', 'editor.find'),
        command('&Replace…', 'editor.replace'),
      ],
    },
    {
      label: '&Paragraph',
      submenu: [
        command('&Paragraph', 'editor.setParagraph'),
        separator(),
        command('Heading &1', 'editor.setHeading1'),
        command('Heading &2', 'editor.setHeading2'),
        command('Heading &3', 'editor.setHeading3'),
        command('Heading &4', 'editor.setHeading4'),
        command('Heading &5', 'editor.setHeading5'),
        command('Heading &6', 'editor.setHeading6'),
        separator(),
        command('&Bulleted List', 'editor.toggleBulletList'),
        command('&Numbered List', 'editor.toggleOrderedList'),
        command('&Task List', 'editor.toggleTaskList'),
        command('Block &Quote', 'editor.toggleBlockquote'),
        command('&Code Block', 'editor.toggleCodeBlock'),
        command('&Math Block', 'editor.insertMath'),
        command('Mermaid &Diagram', 'editor.insertMermaid'),
      ],
    },
    {
      label: 'F&ormat',
      submenu: [
        command('&Bold', 'editor.toggleBold'),
        command('&Italic', 'editor.toggleItalic'),
        command('&Strikethrough', 'editor.toggleStrike'),
        command('&Underline', 'editor.toggleUnderline'),
        command('&Highlight', 'editor.toggleHighlight'),
        command('&Link…', 'editor.editLink'),
        separator(),
        {
          label: '&Table',
          submenu: [
            command('Insert &Table…', 'editor.insertTable'),
            separator(),
            command('Add Row &Above', 'table.addRowBefore'),
            command('Add Row &Below', 'table.addRowAfter'),
            command('Add Column Be&fore', 'table.addColumnBefore'),
            command('Add Column A&fter', 'table.addColumnAfter'),
            separator(),
            command('Delete &Row', 'table.deleteRow'),
            command('Delete &Column', 'table.deleteColumn'),
            separator(),
            command('Copy as &Markdown', 'table.copyMarkdown'),
            command('Copy as T&SV', 'table.copyTsv'),
            separator(),
            command('&Delete Table', 'table.delete'),
          ],
        },
        command('&Image…', 'editor.insertImage'),
      ],
    },
    {
      label: '&View',
      submenu: [
        command('&Source / Structured Mode', 'editor.toggleSourceMode'),
        command('Toggle &Outline', 'view.toggleOutline'),
        separator(),
        command('&Focus Mode', 'view.toggleFocusMode'),
        command('&Typewriter Mode', 'view.toggleTypewriterMode'),
        command('&Zen Mode', 'view.toggleZenMode'),
        command('Full &Screen', 'view.toggleFullscreen'),
        separator(),
        command('Scroll Past &End', 'view.toggleScrollPastEnd'),
        command('&Word Wrap', 'view.toggleWordWrap'),
      ],
    },
    {
      label: '&Themes',
      submenu: [
        command('Theme &Gallery / Settings…', 'theme.gallery'),
        separator(),
        command('Markora &White', 'theme.white'),
        command('Markora &Clean', 'theme.clean'),
        command('Markora &Paper', 'theme.paper'),
        command('Markora &Academic', 'theme.academic'),
        command('Markora &Sepia', 'theme.sepia'),
        command('Markora &Graphite', 'theme.graphite'),
        command('Markora &Midnight', 'theme.midnight'),
        command('Markora &High Contrast', 'theme.highContrast'),
      ],
    },
    {
      label: '&Help',
      submenu: [
        command('&Command Palette…', 'app.commandPalette'),
      ],
    },
  ];

  if (!isPackaged) {
    template.push({
      label: '&Developer',
      submenu: [
        { label: '&Reload', role: 'reload' },
        { label: 'Force &Reload', role: 'forceReload' },
        { label: 'Toggle Developer &Tools', role: 'toggleDevTools' },
      ],
    });
  }

  return template;
}
