# Architecture

## Process model

Markora is a three-boundary Electron application:

1. The main process owns windows, native dialogs, filesystem access, asset I/O, subprocesses,
   workspace workers, recovery stores, spell-check configuration, shell integration, and export.
2. The preload process exposes a narrow, typed `window.markora` bridge. It maps only approved calls and
   events; it does not expose Electron or Node.js objects.
3. The React renderer owns presentation and unprivileged editor state. It cannot directly read a file,
   spawn a program, open an operating-system path, or write an export.

The BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and
`webSecurity: true`. New windows are denied and navigation is restricted to the application URL.

## Canonical document state

`src/renderer/documents/canonical-document.ts` is the authority for each open document. It stores:

- canonical internal text with LF line endings;
- the original disk line-ending choice (`lf` or `crlf`);
- revision and saved-revision snapshots;
- dirty and stale-save state;
- bounded cross-mode undo/redo history; and
- independent source/structured cursor, selection, and scroll snapshots.

CodeMirror and Tiptap are projections of that state. They may hold transient native view state needed
to render and accept input, but they do not own separate saved document copies. A source edit writes the
canonical text. A Tiptap transaction serializes structured HTML to Markdown and writes the same canonical
text. Switching modes materializes the destination projection from the current canonical revision.

Disk serialization applies the recorded line ending only when a save ticket is created. The save ticket
contains a fixed revision/text pair, so an edit made while I/O is in progress remains dirty rather than
being accidentally marked saved.

`large-document-policy.ts` keeps files larger than 2 MiB in Source Mode. This avoids simultaneously
materializing Markdown, structured HTML, a browser DOM, and a ProseMirror tree for very large documents.

## Markdown transformation layer

`src/renderer/markdown/transform.ts` uses Unified/Remark for the Markdown AST and a controlled
Markdown-to-structured-HTML/Turndown pipeline for editor interchange. Front matter, Mermaid/math fences,
reference definitions, footnotes, comments, and safe raw HTML are protected during structured conversion
so they are not mistaken for ordinary editable markup. Table operations live in `tables.ts`.

Opening and saving exclusively through Source Mode does not invoke normalization. Structured edits can
normalize formatting; the contract is documented in `MARKDOWN_NORMALIZATION.md` and protected with
semantic AST and stable-serialization fixtures.

## Renderer feature modules

- `editor/`: CodeMirror Source Mode and Tiptap Structured Mode, including tables, math, Mermaid, images,
  spell-check attributes, search decorations, and writing-mode hooks.
- `documents/`: canonical state and large-document policy.
- `images/`: Markdown/HTML image syntax, validation, dialog, and renderer workflow integration.
- `search/`: current-document search/history and advanced workspace search/replace UI.
- `commands/`: registry, baseline metadata, command palette, shortcut persistence/dispatch, and settings.
- `appearance/`: versioned theme/writing settings, independent interface/document tokens, built-in and
  custom Theme Gallery packages, custom CSS sanitizer, navigation, and the settings/preview panel.
- `components/Dialog.tsx`: the renderer-owned modal primitive. It centralizes portal stacking, inert
  background state, focus trapping/restoration, Escape/backdrop policy, busy state, and accessible names.
- `export/`: HTML and PDF dialogs plus PDF presets.
- `pandoc/`: local conversion UI and diagnostics.
- `recovery/`: recovery/session planning and conflict/recovery dialogs.
- `accessibility/`: common focus, high-contrast, reduced-motion CSS and contrast helpers.

`main.tsx` composes these modules and routes file/editor/search/view/navigation/export actions, the
Structured Mode and table toolbars, keyboard shortcuts, palette results, and validated native-menu events
through central command handlers. `main.tsx` remains a relatively large integration component and should
not regain feature-specific filesystem or conversion logic.

## Privileged services

- `path-authority.ts` tracks user-authorized files, workspaces, assets, and descendants.
- `atomic-file.ts`, `file-recovery-service.ts`, `recovery-store.ts`, and `recovery-ipc.ts` implement
  checked writes, backups, watchers, snapshots, sessions, and recovery IPC.
- `image-assets.ts` and `image-ipc.ts` resolve destinations, copy/write/download images, and expose
  validated operations.
- `pandoc.ts` and `pandoc-ipc.ts` detect and spawn an approved local Pandoc executable without a shell.
- `workspace-search.ts`, its worker, and its IPC adapter provide bounded cancellable search, preview,
  confirmed replacement, and per-file backups.
- `html-export.ts` and `pdf-export.ts` build sanitized rendered output; their IPC adapters own native
  output selection and hidden-window printing.
- `spellcheck.ts` owns Chromium session dictionaries and the native editable context menu.
- `application-menu.ts` builds the explicit mnemonic-labelled application menu. Registry commands carry
  no native accelerator and cross preload only as identifiers from the shared command allowlist; packaged
  menus omit reload and developer tools.
- `launch-files.ts` accepts only existing `.md`/`.markdown` operands, rejects switches/URLs/dev entry
  arguments, and feeds startup or second-instance files through the same authorized open path.
- `navigation-policy.ts` limits navigation to the exact development origin or packaged entry document.

## Persistence

Electron user data contains application settings, spell-check settings/dictionary, recovery snapshots,
session data, conflict/write-failure backups, and temporary Pandoc data. Renderer local storage contains
versioned appearance settings, shortcut overrides, PDF presets, and current-document search history. Custom
theme JSON/CSS packages are stored in the user-data `themes` directory and are never read directly by the
renderer.
Markdown and workspace image assets remain user files.

Writes that protect user text use temporary files and atomic rename. Temporary Pandoc files are removed
after conversion. Recovery and backup retention are bounded in code; the Windows uninstaller deliberately
preserves application data.

## Testing boundaries

- Unit tests run renderer logic/components in JSDOM and isolate main-process services with mocks or
  temporary directories.
- Integration tests run canonical journeys and main/preload/export/recovery boundaries in Node.
- Accessibility tests combine axe component scans, deterministic token contrast, and keyboard/focus
  behavior.
- Performance tests generate realistic document/workspace fixtures and record measurements.
- Playwright E2E tests launch `node_modules/electron/dist/electron.exe` and drive the real renderer and
  native IPC boundary through deterministic dialog hooks.

Clean-machine install, upgrade, signing, and assistive-technology verification are separate release
activities; passing repository automation does not imply they occurred.
