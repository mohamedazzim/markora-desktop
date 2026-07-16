import type {
  CommandDefinition,
  CommandHandler,
  CommandMenuPlacement,
  CommandToolbarPlacement,
} from './registry';
import { APPLICATION_COMMAND_IDS, type ApplicationCommandId } from '../../shared/application-commands';

export const BASELINE_COMMAND_IDS = APPLICATION_COMMAND_IDS;

export type BaselineCommandId = ApplicationCommandId;

export interface BaselineCommandMetadata {
  readonly id: BaselineCommandId;
  readonly label: string;
  readonly category: string;
  readonly defaultShortcut?: string;
  readonly menu?: CommandMenuPlacement;
  readonly toolbar?: CommandToolbarPlacement;
  readonly keywords?: readonly string[];
}

export const BASELINE_COMMAND_METADATA: readonly BaselineCommandMetadata[] = [
  {
    id: 'app.commandPalette',
    label: 'Show Command Palette',
    category: 'Application',
    defaultShortcut: 'Ctrl+Shift+P',
    keywords: ['commands', 'actions'],
  },
  {
    id: 'file.new',
    label: 'New Document',
    category: 'File',
    defaultShortcut: 'Ctrl+N',
    menu: { menu: 'file', group: 'document', order: 10 },
    toolbar: { area: 'primary', order: 10 },
  },
  {
    id: 'file.open',
    label: 'Open File…',
    category: 'File',
    defaultShortcut: 'Ctrl+O',
    menu: { menu: 'file', group: 'document', order: 20 },
    toolbar: { area: 'primary', order: 20 },
  },
  {
    id: 'file.openFolder',
    label: 'Open Folder…',
    category: 'File',
    defaultShortcut: 'Ctrl+Shift+O',
    menu: { menu: 'file', group: 'workspace', order: 30 },
  },
  {
    id: 'file.save',
    label: 'Save',
    category: 'File',
    defaultShortcut: 'Ctrl+S',
    menu: { menu: 'file', group: 'save', order: 40 },
    toolbar: { area: 'primary', order: 30 },
  },
  {
    id: 'file.saveAs',
    label: 'Save As…',
    category: 'File',
    defaultShortcut: 'Ctrl+Shift+S',
    menu: { menu: 'file', group: 'save', order: 50 },
  },
  {
    id: 'file.close',
    label: 'Close Document',
    category: 'File',
    defaultShortcut: 'Ctrl+W',
    menu: { menu: 'file', group: 'document', order: 60 },
  },
  {
    id: 'editor.undo',
    label: 'Undo',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Z',
    menu: { menu: 'edit', group: 'history', order: 10 },
  },
  {
    id: 'editor.redo',
    label: 'Redo',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Y',
    menu: { menu: 'edit', group: 'history', order: 20 },
  },
  {
    id: 'editor.toggleBold',
    label: 'Toggle Bold',
    category: 'Editor',
    defaultShortcut: 'Ctrl+B',
    menu: { menu: 'edit', group: 'format', order: 30 },
    toolbar: { area: 'editor', order: 10 },
  },
  {
    id: 'editor.toggleItalic',
    label: 'Toggle Italic',
    category: 'Editor',
    defaultShortcut: 'Ctrl+I',
    menu: { menu: 'edit', group: 'format', order: 40 },
    toolbar: { area: 'editor', order: 20 },
  },
  {
    id: 'editor.toggleStrike',
    label: 'Toggle Strikethrough',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+X',
    menu: { menu: 'edit', group: 'format', order: 42 },
    toolbar: { area: 'editor', order: 22 },
    keywords: ['strike', 'strikethrough'],
  },
  {
    id: 'editor.toggleUnderline',
    label: 'Toggle Underline',
    category: 'Editor',
    defaultShortcut: 'Ctrl+U',
    menu: { menu: 'edit', group: 'format', order: 44 },
    toolbar: { area: 'editor', order: 24 },
  },
  {
    id: 'editor.toggleHighlight',
    label: 'Toggle Highlight',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+H',
    menu: { menu: 'edit', group: 'format', order: 46 },
    toolbar: { area: 'editor', order: 26 },
    keywords: ['mark', 'background'],
  },
  {
    id: 'editor.editLink',
    label: 'Insert or Edit Link…',
    category: 'Editor',
    defaultShortcut: 'Ctrl+K',
    menu: { menu: 'edit', group: 'format', order: 48 },
    toolbar: { area: 'editor', order: 28 },
    keywords: ['url', 'hyperlink', 'remove link'],
  },
  {
    id: 'editor.setParagraph',
    label: 'Set Paragraph',
    category: 'Editor',
    menu: { menu: 'edit', group: 'format', order: 49 },
    keywords: ['paragraph', 'body text', 'heading level'],
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `editor.setHeading${level}` as BaselineCommandId,
    label: `Set Heading ${level}`,
    category: 'Editor',
    menu: { menu: 'edit' as const, group: 'format', order: 49 + level / 10 },
    keywords: ['heading', `h${level}`, 'paragraph style'],
  })),
  {
    id: 'editor.toggleBulletList',
    label: 'Toggle Bulleted List',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+8',
    menu: { menu: 'edit', group: 'blocks', order: 50 },
    toolbar: { area: 'editor', order: 50 },
    keywords: ['unordered list', 'bullets'],
  },
  {
    id: 'editor.toggleOrderedList',
    label: 'Toggle Numbered List',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+7',
    menu: { menu: 'edit', group: 'blocks', order: 52 },
    toolbar: { area: 'editor', order: 52 },
    keywords: ['ordered list', 'numbered'],
  },
  {
    id: 'editor.toggleTaskList',
    label: 'Toggle Task List',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+9',
    menu: { menu: 'edit', group: 'blocks', order: 54 },
    toolbar: { area: 'editor', order: 54 },
    keywords: ['checklist', 'todo'],
  },
  {
    id: 'editor.toggleBlockquote',
    label: 'Toggle Block Quote',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+Period',
    menu: { menu: 'edit', group: 'blocks', order: 56 },
    toolbar: { area: 'editor', order: 56 },
    keywords: ['quote', 'blockquote'],
  },
  {
    id: 'editor.toggleCodeBlock',
    label: 'Toggle Code Block',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Alt+C',
    menu: { menu: 'edit', group: 'blocks', order: 58 },
    toolbar: { area: 'editor', order: 58 },
    keywords: ['fence', 'preformatted'],
  },
  {
    id: 'editor.toggleSourceMode',
    label: 'Toggle Source Mode',
    category: 'Editor',
    defaultShortcut: 'Ctrl+Shift+M',
    menu: { menu: 'view', group: 'editor', order: 10 },
    toolbar: { area: 'view', order: 10 },
    keywords: ['structured', 'markdown'],
  },
  {
    id: 'editor.insertTable',
    label: 'Insert Table',
    category: 'Insert',
    defaultShortcut: 'Ctrl+Shift+T',
    menu: { menu: 'insert', group: 'blocks', order: 10 },
    toolbar: { area: 'editor', order: 30 },
  },
  {
    id: 'editor.insertImage',
    label: 'Insert Image…',
    category: 'Insert',
    defaultShortcut: 'Ctrl+Shift+I',
    menu: { menu: 'insert', group: 'media', order: 20 },
    toolbar: { area: 'editor', order: 40 },
  },
  {
    id: 'editor.insertMath',
    label: 'Insert Math Block',
    category: 'Insert',
    defaultShortcut: 'Ctrl+Alt+M',
    menu: { menu: 'insert', group: 'blocks', order: 30 },
    toolbar: { area: 'editor', order: 60 },
    keywords: ['katex', 'equation'],
  },
  {
    id: 'editor.insertMermaid',
    label: 'Insert Mermaid Diagram',
    category: 'Insert',
    defaultShortcut: 'Ctrl+Alt+D',
    menu: { menu: 'insert', group: 'blocks', order: 40 },
    toolbar: { area: 'editor', order: 62 },
    keywords: ['diagram', 'flowchart'],
  },
  {
    id: 'editor.find',
    label: 'Find',
    category: 'Search',
    defaultShortcut: 'Ctrl+F',
    menu: { menu: 'edit', group: 'search', order: 50 },
  },
  {
    id: 'editor.replace',
    label: 'Replace',
    category: 'Search',
    defaultShortcut: 'Ctrl+H',
    menu: { menu: 'edit', group: 'search', order: 60 },
  },
  {
    id: 'table.addRowBefore',
    label: 'Add Table Row Above',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 50 },
    keywords: ['row above', 'table'],
  },
  {
    id: 'table.addRowAfter',
    label: 'Add Table Row Below',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 52 },
    keywords: ['row below', 'table'],
  },
  {
    id: 'table.addColumnBefore',
    label: 'Add Table Column Before',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 54 },
    keywords: ['column left', 'table'],
  },
  {
    id: 'table.addColumnAfter',
    label: 'Add Table Column After',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 56 },
    keywords: ['column right', 'table'],
  },
  {
    id: 'table.deleteRow',
    label: 'Delete Table Row',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 58 },
  },
  {
    id: 'table.deleteColumn',
    label: 'Delete Table Column',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 60 },
  },
  {
    id: 'table.copyMarkdown',
    label: 'Copy Table as Markdown',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 62 },
    keywords: ['clipboard', 'copy table'],
  },
  {
    id: 'table.copyTsv',
    label: 'Copy Table as TSV',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 64 },
    keywords: ['clipboard', 'tab separated'],
  },
  {
    id: 'table.delete',
    label: 'Delete Table',
    category: 'Table',
    menu: { menu: 'insert', group: 'table', order: 66 },
  },
  {
    id: 'view.toggleFocusMode',
    label: 'Toggle Focus Mode',
    category: 'View',
    defaultShortcut: 'Ctrl+Alt+F',
    menu: { menu: 'view', group: 'writing', order: 20 },
  },
  {
    id: 'view.toggleTypewriterMode',
    label: 'Toggle Typewriter Mode',
    category: 'View',
    defaultShortcut: 'Ctrl+Alt+T',
    menu: { menu: 'view', group: 'writing', order: 30 },
  },
  {
    id: 'view.toggleZenMode',
    label: 'Toggle Zen Mode',
    category: 'View',
    defaultShortcut: 'Ctrl+K Z',
    menu: { menu: 'view', group: 'writing', order: 40 },
  },
  {
    id: 'view.toggleOutline',
    label: 'Toggle Outline',
    category: 'View',
    defaultShortcut: 'Ctrl+Alt+O',
    menu: { menu: 'view', group: 'panels', order: 50 },
  },
  {
    id: 'view.toggleFullscreen',
    label: 'Toggle Full Screen',
    category: 'View',
    defaultShortcut: 'F11',
    menu: { menu: 'view', group: 'writing', order: 60 },
  },
  {
    id: 'view.toggleScrollPastEnd',
    label: 'Toggle Scroll Past End',
    category: 'View',
    menu: { menu: 'view', group: 'editor', order: 70 },
  },
  {
    id: 'view.toggleWordWrap',
    label: 'Toggle Word Wrap',
    category: 'View',
    defaultShortcut: 'Alt+Z',
    menu: { menu: 'view', group: 'editor', order: 80 },
  },
  {
    id: 'navigation.top',
    label: 'Jump to Top',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+Home',
  },
  {
    id: 'navigation.bottom',
    label: 'Jump to Bottom',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+End',
  },
  {
    id: 'navigation.selection',
    label: 'Jump to Selection',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+Shift+J',
  },
  {
    id: 'navigation.previousHeading',
    label: 'Previous Heading',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+PageUp',
  },
  {
    id: 'navigation.nextHeading',
    label: 'Next Heading',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+PageDown',
  },
  {
    id: 'navigation.previousParagraph',
    label: 'Previous Paragraph',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+Alt+ArrowUp',
  },
  {
    id: 'navigation.nextParagraph',
    label: 'Next Paragraph',
    category: 'Navigation',
    defaultShortcut: 'Ctrl+Alt+ArrowDown',
  },
  {
    id: 'export.html',
    label: 'Export HTML…',
    category: 'Export',
    menu: { menu: 'export', group: 'native', order: 10 },
  },
  {
    id: 'export.pdf',
    label: 'Export PDF…',
    category: 'Export',
    menu: { menu: 'export', group: 'native', order: 20 },
  },
  {
    id: 'export.pandoc',
    label: 'Export with Pandoc…',
    category: 'Export',
    menu: { menu: 'export', group: 'pandoc', order: 30 },
  },
  {
    id: 'theme.gallery',
    label: 'Theme Gallery / Settings…',
    category: 'Themes',
  },
  {
    id: 'theme.white',
    label: 'Markora White',
    category: 'Themes',
    keywords: ['classic white', 'light', 'typora', 'paper'],
  },
  {
    id: 'theme.clean',
    label: 'Markora Clean',
    category: 'Themes',
  },
  {
    id: 'theme.paper',
    label: 'Markora Paper',
    category: 'Themes',
  },
  {
    id: 'theme.academic',
    label: 'Markora Academic',
    category: 'Themes',
  },
  {
    id: 'theme.sepia',
    label: 'Markora Sepia',
    category: 'Themes',
  },
  {
    id: 'theme.graphite',
    label: 'Markora Graphite',
    category: 'Themes',
  },
  {
    id: 'theme.midnight',
    label: 'Markora Midnight',
    category: 'Themes',
  },
  {
    id: 'theme.highContrast',
    label: 'Markora High Contrast',
    category: 'Themes',
  },
] as const;

export type BaselineCommandHandlers<TContext> = Readonly<Record<BaselineCommandId, CommandHandler<TContext>>>;

export function createBaselineCommandDefinitions<TContext>(
  handlers: BaselineCommandHandlers<TContext>,
  enabled: Partial<Record<BaselineCommandId, CommandDefinition<TContext>['enabled']>> = {},
): readonly CommandDefinition<TContext>[] {
  return BASELINE_COMMAND_METADATA.map((metadata) => {
    const handler = handlers[metadata.id];
    if (typeof handler !== 'function') {
      throw new Error(`A real handler is required for baseline command "${metadata.id}".`);
    }
    return Object.freeze({
      ...metadata,
      handler,
      enabled: enabled[metadata.id] ?? true,
    });
  });
}
