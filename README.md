# Markora Desktop

Markora Desktop is an open-source, offline-first Markdown workspace for Windows. It is built with
Electron, React, and TypeScript and provides two editing projections over one canonical Markdown document:
Tiptap Structured Mode and CodeMirror Source Mode.

Version 0.2.2 is a Windows patch release. The current release includes the core editing, image,
search, customization, export, recovery, accessibility, and packaging paths. A clean Windows
VM/Sandbox installation has not been performed on the current machine, and Pandoc remains optional.
See the
[implementation status](docs/IMPLEMENTATION_STATUS.md) and
[known limitations](docs/KNOWN_LIMITATIONS.md).

Repository: https://github.com/mohamedazzim/markora-desktop  
License: MIT

## Features

- Structured and source editing backed by one authoritative Markdown state
- GFM tables and task lists, front matter, reference links, footnotes, fenced code, KaTeX math,
  and Mermaid diagrams rendered with strict security
- Image paste, drag and drop, file selection, URLs, configurable asset destinations, and image
  editing actions
- Current-document and cancellable background workspace search and replace
- Central registry/palette for baseline application commands and configurable single- or multi-key
  shortcuts
- Focus, Typewriter, Zen, full-screen, navigation, word-wrap, and scroll-past-end controls
- Nine built-in themes, independent interface/document Theme Gallery selections, typography and element
  styling, validated custom package import/export, and scoped custom CSS
- Configurable rendered HTML and Chromium PDF export with previews
- Optional local Pandoc import/export and Chromium spell checking
- Atomic checked writes, backups, recovery snapshots, external-change detection, and conflict
  handling foundations
- Session restoration plus validated one/multiple-file command-line opening and single-instance forwarding
- NSIS, portable, and unpacked x64 Windows packaging targets

## Requirements

- Windows 10 or Windows 11, x64
- Node.js 22 through 24
- npm 10 or newer
- PowerShell 5.1 or newer for the diagnostic and Windows helper scripts
- Pandoc only when optional Pandoc import/export is needed

## Development

Use the lockfile and allow the Electron postinstall check to run:

```powershell
npm ci
npm run doctor
npm start
```

`npm start` and `npm run dev` both launch Vite, the Electron TypeScript watcher, and the Electron
binary installed in `node_modules`. `npm run dev:clean` first removes generated Electron output.
It does not point development at a packaged executable.

Run the verification suites separately when diagnosing a failure:

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:accessibility
npm run test:performance
npm run test:e2e
npm run build
```

`npm run test:e2e` launches the real local Electron executable through Playwright's Electron API.
The 0.2.2 verification run passed 640 unit, 42 integration, 43 real-Electron E2E, 40 accessibility,
and 14 performance tests; the E2E run had no skips.
See [testing](docs/TESTING.md) and the
[development-environment fix](docs/DEVELOPMENT_ENVIRONMENT_FIX.md).

## Large documents

Source Mode remains available for large files. Documents larger than 2 MiB stay in Source Mode to
avoid materializing both a structured HTML representation and a ProseMirror tree in the renderer.
This is a deliberate safety policy, not a truncation: the full Markdown text can still be edited and
saved.

## Packaging

```powershell
npm run package:dir
npm run package
```

`npm run package` targets an x64 NSIS installer, a portable executable, and an unpacked application,
then creates SHA-256 metadata when all expected artifacts and versioned release notes exist. Builds
are currently unsigned. Packaging output belongs in `release/` and is not evidence of a successful
clean-machine install or upgrade.

## Architecture

- `electron/main` owns privileged file, asset, Pandoc, search, spell-check, recovery, and export work.
- `electron/preload` exposes the narrow typed `window.markora` bridge.
- `src/renderer/documents` contains the canonical document and large-document policy.
- `src/renderer/editor` contains the CodeMirror and Tiptap projections.
- `src/renderer/markdown` contains Markdown parsing, transformation, normalization, and tables.
- Feature modules under `src/renderer` provide images, search, commands, appearance, recovery, and
  export dialogs.
- `src/shared` contains IPC contracts and export schemas shared across process boundaries.
- `tests` contains unit, integration, accessibility, performance, and real-Electron E2E suites.

Read the [architecture](docs/ARCHITECTURE.md), [security policy](SECURITY.md),
[privacy policy](PRIVACY.md), and [feature matrix](docs/FEATURE_MATRIX.md) before changing a
privileged boundary.

## License

MIT.
