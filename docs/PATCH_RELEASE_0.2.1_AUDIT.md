# Markora 0.2.1 patch-release audit

Date: 2026-07-16

## Scope

This audit covers the tab, workspace-tree, Markdown-link, Mermaid, and command-palette fixes in the private Windows application. The existing 0.2.0 artifacts are preserved. The local package is already versioned `0.2.1`; packaging will regenerate only the 0.2.1-named artifacts.

## Fixed defects and source files

- Tab context actions and guarded bulk close: `src/renderer/main.tsx`, `src/renderer/styles.css`.
- Collapsed/lazy workspace tree, empty-folder behavior, and unsupported-file handling: `src/renderer/main.tsx`, `src/renderer/styles.css`, `electron/main/index.ts`.
- Relative Markdown-link navigation: `src/renderer/main.tsx`, `src/renderer/editor/StructuredEditor.tsx`.
- Mermaid/math fence recognition and reopened-diagram parsing: `src/renderer/markdown/transform.ts`, `src/renderer/editor/StructuredEditor.tsx`.
- Command-palette dialog contrast: `src/renderer/commands/command-palette.css`.
- Conflict overwrite focus sequencing: `src/renderer/recovery/ConflictDialog.tsx`.

## Release configuration

- Version: `0.2.1` in `package.json`.
- Electron Builder targets: x64 NSIS installer and x64 portable executable.
- Artifact names: `Markora-0.2.1-Setup-x64.exe` and `Markora-0.2.1-Portable-x64.exe`.
- Release finalization: `scripts/finalize-release.mjs`.

## Verification

- Typecheck, lint, build, unit, integration, accessibility, performance, visual, and Electron Playwright suites passed.
- Last full Electron E2E run: 42 passing tests.
- Dependency audit: 0 high-severity vulnerabilities.
- `npm run format:check` still reports legacy/pre-existing formatting drift outside the files changed for this patch.
- Packaged `release/win-unpacked/Markora.exe` launched successfully after packaging.

## Regression risks

- Bulk closing several dirty tabs uses one confirmation and must preserve cancellation semantics.
- Workspace traversal now lists unsupported files while keeping Markdown opening restricted.
- Relative link resolution must remain portable across Windows path separators and encoded spaces.
- Mermaid parsing must not reinterpret ordinary fenced code blocks.

## Artifacts

Packaging will produce the versioned installer, portable executable, unpacked executable, checksums, release manifest, release notes, and clean-VM verification materials under `release/`.

## Remaining limitations

Clean-VM installation and upgrade validation require a separate clean Windows environment; no such environment is claimed by this audit.
