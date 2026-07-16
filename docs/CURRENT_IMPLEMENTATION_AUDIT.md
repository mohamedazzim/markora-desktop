# Current implementation audit

Audit date: 2026-07-15  
Application version: 0.2.0

This audit is based on repository source, IPC contracts, package/build configuration, scripts, fixtures,
and automated test definitions. Final command output, artifact paths, and measured performance belong in
the implementation-phase final report. A test file or implementation path is not represented here as a
successful release-environment check unless that check was actually recorded.

## Architecture now present

- Electron 43, React 19, TypeScript, and Vite with a sandboxed/context-isolated BrowserWindow.
- A typed preload bridge for files, workspaces, exports, images, Pandoc, spell checking, recovery, and
  progress/external-change events.
- A canonical Markdown document model shared by CodeMirror Source Mode and Tiptap Structured Mode.
- Dedicated renderer modules for Markdown transformation, images, search, commands/shortcuts,
  appearance/writing modes, export, Pandoc, and recovery UI.
- Dedicated main-process modules for checked writes, recovery/session storage, path authority, image
  assets, safe Pandoc spawning, background workspace search, and HTML/PDF export.
- NSIS, portable, and unpacked x64 Windows build targets with release finalization/checksum tooling.

## Implemented feature paths

### Development environment

The local Electron package is a development dependency and its install script is enforced at project
postinstall. `start` delegates to `dev`; the development pipeline compiles Electron TypeScript and runs
Vite, a TypeScript watcher, wait-on, and the local Electron CLI. `dev:clean` and the actionable Windows
doctor script are present. The original failure and repair are documented separately.

### Editing and Markdown

- One canonical document state owns text, line endings, revisions, dirty state, bounded history, save
  tickets, and per-mode view snapshots.
- Source and structured projections exchange current canonical text; semantic and stable serialization
  tests cover the complete source -> structured -> source -> save -> reopen journey.
- Front matter, code, math, Mermaid, tables with escaped pipes, reference links, footnotes, raw HTML,
  images, Unicode, empty documents, and LF/CRLF have focused fixtures.
- Structured Mode includes marks, headings, links/images, lists/tasks, code, table insertion/manipulation,
  KaTeX preview, strict Mermaid preview, formatting toolbar keyboard support, and search decorations.
- Files larger than 2 MiB intentionally remain Source-Mode-only.

### Images and local tools

- Clipboard paste, drag/drop, picker, URL, existing Markdown/HTML syntax parsing, image metadata/dimensions,
  asset destination strategies, safe Windows filenames, conflict renaming, relative/workspace paths,
  bounded remote downloads, cancellation, and broken-reference errors are implemented.
- Image actions cover replacement/edit, removal, reveal, external open, copy path, copy bitmap, and remote
  localization where the source type supports the action.
- Pandoc supports PATH/common-directory/manual detection, version validation, approved input/output
  pickers, import preview, seven export and five import format identifiers, cancellation, timeout, and
  captured diagnostics. Mock-executable tests exist. A real smoke conversion is Blocked because Pandoc
  is absent in this environment.
- Chromium spell checking exposes global enable/language, per-document language, native suggestions,
  persistent dictionary words, and session ignore. It does not use an online service.

### Search, commands, and appearance

- Document search supports literal/regex, case, whole word, navigation, count, history, replacement,
  selection scope, and replace-all confirmation metadata over canonical Markdown in both editor modes.
  Structured Mode maps captured ProseMirror selections and visible matches to deterministic canonical
  offsets so mode switching does not create a second search state.
- Workspace search runs in a worker, supports filename/content/both, include/exclude globs, root
  `.gitignore`, custom ignored directories, grouping/previews/counts, exact-line opening, cancellation,
  selected preview replacement, token-bound confirmation, backups, and per-file results.
- The command registry has stable metadata and shared handlers for baseline file, editor, search, view,
  navigation, and export actions. The palette and shortcut manager provide keyboard navigation,
  recording, conflict resolution, reset, versioned persistence, import/export, and chords. Structured
  marks, links, lists, quote/code, math/Mermaid, and table-operation buttons use those same handlers.
- The explicit native application menu sends only shared-allowlist command identifiers through preload
  to the renderer registry. It assigns no accelerators to configurable commands; packaged menus omit
  reload/developer tools. Focused unit, preload integration, and real-Electron dispatch tests pass.
- Focus, Typewriter, Zen, full screen, width, wrap, scroll-past-end, and document-navigation actions are
  implemented and persisted with appearance settings.
- Nine built-in theme families, independent interface/document selection, Theme Gallery previews,
  validated global custom package import/duplicate/edit/export/delete, typography/spacing, element
  appearances, and scoped custom CSS are implemented.

### Export

- HTML export supports styled/unstyled, standalone/fragment, embedded or omitted CSS, optional local
  image embedding, TOC, five themes, syntax highlighting, KaTeX, strict local Mermaid runtime,
  metadata, stable heading anchors, UTF-8, warnings, preview, and sanitized output.
- PDF export supports standard/custom page sizes, orientation, margins, scale, backgrounds,
  headers/footers/page numbers, metadata, TOC, themes, sanitized print CSS, page-break controls, preview,
  named presets, cancellation, and Chromium `printToPDF`.
- Unit/integration fixtures exercise export composition and output structure. Real visual comparison,
  heading bookmarks/tagged PDF behavior, and every rich fixture in a release build still require the
  manual procedure in `PDF_EXPORT_VALIDATION.md`.

### Recovery, accessibility, and packaging

- Atomic fingerprinted writes, backups, write-failure classification, watcher debouncing, deletion and
  same-directory rename detection, retained snapshots, session records, restore/conflict controllers,
  and accessible conflict/recovery components are wired into the shell. Startup presents a selectable
  recovery center; external changes use the typed conflict dialog. Focused real-Electron recovery,
  conflict, and session-relaunch flows pass.
- Semantic trees/tabs/panels/toolbars/dialogs, the shared portal/inert Dialog primitive with focus
  trapping/restoration, live regions, focus-visible,
  forced-color, reduced-motion, and token-contrast checks have been implemented. Automated component
  accessibility tests exist; no Narrator/NVDA/high-contrast/200% scaling certification was performed.
- Real-Electron Playwright flows cover the principal editor, image, workspace, command, writing-mode,
  theme, export, recovery, conflict, session relaunch, command-line multiple-file opening, and
  accessibility paths. The final run passed 36/36 tests with no skips, including recovery/session/CLI,
  Chromium PDF, native-menu, rendered axe-core, and second-instance forwarding flows.
- Startup command lines accept only existing Markdown files and queue them until the renderer is ready;
  real-Electron startup verifies multiple operands. A dedicated E2E also leaves the primary responsive,
  launches a second Electron process, and verifies forwarding/focus behavior.
- Electron Builder is configured for x64 NSIS, portable, and unpacked outputs and `.md`/`.markdown`
  associations. Artifact generation is not equivalent to fresh-install, upgrade, uninstall, or clean-VM
  validation.

## Remaining release gaps and risks

- Pandoc is not installed, so only mocked conversion is verified locally.
- The 2 MiB Structured Mode ceiling is a deliberate memory-safety limitation.
- Raw HTML/reference/footnote constructs are primarily preservation features; they do not all have
  dedicated rich editing controls.
- PDF bookmarks/tagging/internal-link fidelity depends on Chromium and needs artifact inspection.
- The application is unsigned and has no update feed.
- A real clean Windows VM/Windows Sandbox install was not performed.
- The development-host 0.1.0-to-0.2.0 current-user upgrade, settings hash, Start Menu and redirected
  Desktop shortcuts, associations/Open With, unpacked/portable/installed multi-file launch, uninstall,
  and reinstall passed. The same matrix still requires clean-machine repetition.
- Manual assistive-technology and visual export checks remain open.
- Large-scale benchmark conclusions must come from the measured performance report, not fixture presence.
- The production renderer entry chunk remains 2,652.57 KB minified (784.68 KB gzip); feature-level code
  splitting is future performance work.

See `FEATURE_MATRIX.md` for implementation and verification status and `KNOWN_LIMITATIONS.md` for the
user-visible impact.
