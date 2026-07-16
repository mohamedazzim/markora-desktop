# Markora Desktop 0.2.2 patch-release audit

## Scope

This patch addresses the reported runtime defect where rendered Markdown links
were visible but did not reliably open their target documents. The private
desktop source remains in `C:\Markdown_Project`; the VS Code repository is not
modified or merged.

## Root cause

The previous renderer-side resolver treated links as ad-hoc Windows strings.
It did not consistently handle encoded filenames, Unicode paths, `file:///`
URIs, decoded heading fragments, malformed escapes, or the asynchronous render
boundary after opening another document. The click hook also had no keyboard
activation path for a caret inside a linked mark.

## Changes

- `src/renderer/documents/markdown-links.ts` centralizes classification and
  safe resolution for external links, anchors, local paths, file URIs, and
  document fragments.
- `src/renderer/main.tsx` uses the resolver, reports invalid links, and queues
  cross-document heading navigation until the target editor is mounted.
- `src/renderer/editor/StructuredEditor.tsx` handles links from any DOM Element
  and supports Enter activation for linked text.
- `tests/unit/markdown-links.test.ts` covers 11 resolver cases.
- `tests/e2e/electron-fixture.ts` adds encoded, Unicode, and heading fixtures.
- `tests/e2e/flows.e2e.spec.ts` adds real Electron cross-document navigation.

## Security boundary

Only HTTP(S), `mailto:`, and local/file links are accepted. Local paths still
pass through main-process `assertAuthorizedFile`, which permits explicitly
opened files and files inside a user-selected workspace. No Node filesystem API
is exposed to the renderer.

## Release

- Target version: `0.2.2`.
- Existing 0.2.1 installer, portable executable, checksums, and manifest are
  preserved.
- New artifacts are generated under the existing `release` directory with
  `0.2.2` filenames plus `SHA256SUMS-0.2.2.txt` and
  `release-manifest-0.2.2.json`. The prior generic 0.2.1 metadata remains
  unchanged.

## Known limitations

- Non-Markdown local links intentionally show an unsupported-format message.
- Links to files outside an authorized workspace require the normal Markora
  open-file authorization flow.
