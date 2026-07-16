# Commands and shortcuts

Markora registers application actions in a central command registry. The native Windows menu, primary
and Structured/table toolbars, command palette, and shortcuts call those shared handlers. Each command
has a stable identifier, label, category, enabled-state rule, optional menu/toolbar metadata, and optional
default shortcut.

The native menu carries only identifiers from a shared allowlist across the isolated preload bridge. It
does not assign native accelerators to configurable commands, so user shortcut settings remain the only
keyboard dispatch path. Native Cut, Copy, Paste, Delete, and Select All roles are retained because Markora
does not define competing registry commands for them. Reload and developer tools appear only in an
unpackaged development menu.

The Structured editor paragraph-style selector dispatches `editor.setParagraph` and
`editor.setHeading1` through `editor.setHeading6`; the native **Format > Paragraph Style** menu uses
those same identifiers. Heading changes therefore share the registry handler and enabled-state path
with palette, toolbar, and future user-shortcut bindings.

## Default shortcuts

| Shortcut | Command | Identifier |
|---|---|---|
| `Ctrl+Shift+P` | Show Command Palette | `app.commandPalette` |
| `Ctrl+N` | New Document | `file.new` |
| `Ctrl+O` | Open File | `file.open` |
| `Ctrl+Shift+O` | Open Folder | `file.openFolder` |
| `Ctrl+S` | Save | `file.save` |
| `Ctrl+Shift+S` | Save As | `file.saveAs` |
| `Ctrl+W` | Close Document | `file.close` |
| `Ctrl+Z` | Undo | `editor.undo` |
| `Ctrl+Y` | Redo | `editor.redo` |
| `Ctrl+B` | Toggle Bold | `editor.toggleBold` |
| `Ctrl+I` | Toggle Italic | `editor.toggleItalic` |
| `Ctrl+Shift+M` | Toggle Source Mode | `editor.toggleSourceMode` |
| `Ctrl+Shift+T` | Insert Table | `editor.insertTable` |
| `Ctrl+Shift+I` | Insert Image | `editor.insertImage` |
| `Ctrl+F` | Find | `editor.find` |
| `Ctrl+H` | Replace | `editor.replace` |
| `Ctrl+Alt+F` | Toggle Focus Mode | `view.toggleFocusMode` |
| `Ctrl+Alt+T` | Toggle Typewriter Mode | `view.toggleTypewriterMode` |
| `Ctrl+K`, then `Z` | Toggle Zen Mode | `view.toggleZenMode` |
| `Ctrl+Alt+O` | Toggle Outline | `view.toggleOutline` |
| `F11` | Toggle Full Screen | `view.toggleFullscreen` |
| `Alt+Z` | Toggle Word Wrap | `view.toggleWordWrap` |
| `Ctrl+Home` | Jump to Top | `navigation.top` |
| `Ctrl+End` | Jump to Bottom | `navigation.bottom` |
| `Ctrl+Shift+J` | Jump to Selection | `navigation.selection` |
| `Ctrl+PageUp` | Previous Heading | `navigation.previousHeading` |
| `Ctrl+PageDown` | Next Heading | `navigation.nextHeading` |
| `Ctrl+Alt+ArrowUp` | Previous Paragraph | `navigation.previousParagraph` |
| `Ctrl+Alt+ArrowDown` | Next Paragraph | `navigation.nextParagraph` |

Toggle Scroll Past End and export commands are available in the command palette even though they have no
default shortcut.

Search panels also support Enter/Shift+Enter, F3/Shift+F3, Escape, and ordinary Tab navigation where
appropriate. The palette supports Arrow keys, Home, End, Enter, Escape, and trapped Tab navigation.

## Command palette

Open the palette with `Ctrl+Shift+P`, type words from a label/category/keyword/identifier, move with Arrow
keys or Home/End, and press Enter. Disabled commands remain discoverable but cannot execute. Closing the
palette restores focus to the invoking control.

## Customizing shortcuts

The Settings sidebar lists commands and current bindings. A binding can be recorded from the keyboard,
removed, reset to its default, or all bindings can be reset. The manager normalizes Windows modifier/key
names and supports multi-key chords (two strokes in the current UI; the recorder supports bounded longer
profiles internally).

When a shortcut conflicts, choose the explicit replacement/swap policy offered by the UI or cancel. The
manager never silently leaves two commands with the same effective binding.

Shortcut settings use a versioned JSON envelope in local storage. Import is limited to 1 MB, validates
known command IDs and bindings, reports ignored unknown commands, and applies an explicit conflict policy.
Export downloads a portable JSON profile. Importing a profile does not grant filesystem or IPC access.

## Adding a command

Add a stable dotted identifier to `src/shared/application-commands.ts`, add its label/placement metadata
to `src/renderer/commands/baseline.ts`, provide a real handler when the registry is composed, and define an
enabled-state rule if needed. Route visible controls through registry execution. If it belongs in the
native menu, add an identifier-only item to `electron/main/application-menu.ts`; never add a duplicate
native accelerator. Add registry, shortcut, palette, menu, and integration tests.
