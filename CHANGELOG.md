# Changelog

All notable changes are documented here. Dates use ISO 8601.

## 0.2.2 - 2026-07-16

### Added

- VS Code-style tab context actions: Close, Close Others, Close All to the
  Right, and Close All, with one confirmation for affected unsaved documents.
- Workspace trees now open collapsed, retain every file entry, and omit
  disclosure controls for empty folders. Unsupported files explain why they
  cannot be opened in Markora.
- Relative Markdown links in Structured Mode now open the target document;
  external links continue through the validated external-link policy.

### Fixed

- Existing Mermaid fences are parsed ahead of generic code blocks so diagrams
  render when a Markdown file is reopened.
- Command-palette dialog colors now use the shared application dialog tokens.
- Structured-editor links now resolve relative, parent, nested, encoded,
  Unicode, file-URI, same-document, and cross-document heading links.
- Safe external links now use the validated external-link bridge, while
  unsupported or malformed protocols produce an actionable message.
- Cross-document heading links now activate the target tab and scroll to the
  matching heading after the target editor has rendered.

## Unreleased

## 0.2.1 - 2026-07-16

### Fixed

- Rebuilt the shared modal surface and portal token boundary so Edit link and
  every other application dialog remain opaque, readable, keyboard accessible,
  and independent from document themes or custom Markdown CSS.
- Added safe link-destination validation, explicit Remove link behavior, and
  focused Electron/axe/visual regression coverage.
- Added VS Code-style tab context actions, collapsed workspace trees, and
  actionable unsupported-file handling.
- Fixed relative Markdown links and Mermaid tilde/indented fences when files
  are reopened.
- Fixed command-palette colors to use the shared application dialog tokens.

## 0.2.0 - 2026-07-15

### Added

- A shared accessible Dialog primitive with portal stacking, inert background handling, focus trapping,
  focus restoration, reduced-motion support, and consistent visual tokens across settings, export,
  recovery, image, Pandoc, command-palette, and shortcut dialogs.
- Redesigned conflict resolution with timestamp metadata, explicit reload/keep/save-copy/replace actions,
  bounded unified diffing, aligned side-by-side comparison, and keyboard-safe overwrite confirmation.
- An independent interface/document Theme Gallery with built-in previews and validated global custom theme
  packages (import, duplicate, edit, export, delete) persisted under Electron user data.

- A canonical Markdown document model with bounded undo/redo history, per-mode cursor/selection and
  scroll snapshots, checked save tickets, dirty-state tracking, and external-change classification.
- Broad Markdown round-trip fixtures for front matter, code, math, Mermaid, tables with escaped pipes,
  reference links, footnotes, raw HTML, images, Unicode, empty documents, and line endings.
- Image paste, drag/drop, picker, remote URL, local-copy strategies, safe filename/path handling,
  remote download cancellation, and image editing actions through typed IPC.
- Optional Pandoc detection, executable selection, import preview, export, progress, cancellation,
  timeout, and captured diagnostic output for the supported formats.
- Chromium spell checking with language selection, document override, native suggestions, persistent
  dictionary words, and session-only ignored words.
- Current-document find/replace and advanced background workspace search/replace with preview,
  selection, explicit confirmation, cancellation, and backups.
- A central command registry, searchable keyboard command palette, configurable shortcuts, conflict
  handling, versioned persistence, import/export, and multi-key chord support.
- Focus, Typewriter, Zen, full-screen, navigation, width, wrap, and scroll-past-end controls.
- Nine built-in theme families, system light/dark observation, source/code/Mermaid themes, typography
  and element controls, theme import/export, and scoped custom CSS.
- Rendered HTML export and Chromium PDF export dialogs with preview, styling, metadata, image, math,
  Mermaid, page, header/footer, page-break, and preset controls.
- Checked atomic writes, backups, retained recovery snapshots, session records, rename/deletion
  detection, and conflict-resolution components.
- Validated command-line Markdown operands, multiple-file startup, queued renderer delivery, and
  single-instance forwarding/focus.
- Automated accessibility, performance, integration, and real-Electron Playwright test projects.
- NSIS and portable targets, release finalization/checksum tooling, and a clean-machine test plan.

### Changed

- Upgraded Electron to 43.1.0 and set the supported development Node.js range to 22-24.
- Replaced workspace tree text disclosure markers with Lucide vector icons and typed file-category
  icons, including 28px rows, indentation, ellipsis, hover, focus, and active-file states.
- Strengthened the shared modal scrim and elevated panel treatment, removed legacy overlay overrides,
  and added a scoped Typora-inspired white document stylesheet for the complete supported Markdown
  element set.
- Incremented the application version from 0.1.0 to 0.2.0.
- Files larger than 2 MiB now remain in Source Mode to bound structured-editor memory use.
- HTML and PDF exports now operate on sanitized rendered document content rather than escaped Markdown
  in a `pre` element.

### Fixed

- Repaired the reproducible development launch path after an interrupted Electron archive extraction
  left package metadata without `path.txt` or `electron.exe`.
- Made `npm start` delegate to the complete local development pipeline and added `dev:clean` and
  `doctor` commands.
- Stabilized source-to-structured-to-source serialization and preserved original LF/CRLF choice when
  writing a file.

### Security

- Added path-authority checks and runtime payload schemas to privileged image, Pandoc, workspace,
  recovery, and export operations.
- Pandoc uses direct executable spawning with argument arrays and no shell.
- HTML, Mermaid, PDF input, URLs, and custom CSS use separate validation and sanitization layers.
- Removed the redundant legacy direct Electron rebuild dependency; Electron Builder owns the fixed 4.2
  toolchain. Both the full dependency-tree audit and the required production-only high-severity audit
  report zero vulnerabilities.

### Verification

- Current automated baseline: 625 unit, 42 integration, 36 real-Electron E2E, 39 accessibility, and 14
  performance tests passed; the E2E run had no skips.
- The production renderer entry chunk is 2,652.57 KB minified (784.68 KB gzip). Feature-level code
  splitting remains future performance work.

### Verification limitations

- Mocked Pandoc tests exist, but no real Pandoc smoke conversion was run because Pandoc is absent.
- The development-host 0.1.0-to-0.2.0 upgrade, settings-retention, association, shortcut, launch,
  uninstall, and reinstall matrix passed. A clean Windows VM/Windows Sandbox install, code signing,
  and the full manual PDF/accessibility matrix remain release-candidate work.

## 0.1.0 - 2026-07-14

- Established the secure Electron, React, TypeScript, and Vite application foundation.
- Added initial Markdown editing, file/workspace workflows, recovery, settings, HTML/PDF export,
  packaging, tests, and documentation.
