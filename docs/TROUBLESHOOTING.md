# Troubleshooting

## `Electron failed to install correctly`

Stop all npm/Electron/Vite/TypeScript processes using this workspace, then run:

```powershell
npm rebuild electron --foreground-scripts
npm run doctor
```

If the lock/dependency tree is also inconsistent:

```powershell
npm ci --foreground-scripts
npm run doctor
```

Do not point `npm start` at a packaged executable. Review proxy/mirror/certificate settings, download cache,
disk space, permissions, and security-software quarantine if foreground installation reports a download
or removal problem. See `DEVELOPMENT_ENVIRONMENT_FIX.md`.

## Development window is blank or stale

```powershell
npm run dev:clean
```

Confirm port 5173 is not owned by an unrelated process and read all three concurrently labeled streams.
The Electron TypeScript compilation must finish and Vite must be reachable before Electron loads the page.

## Doctor reports an unsupported runtime

Use Node.js 22-24 and npm 10 or newer. A matching x64 Node process is recommended for x64 Windows
packaging. Rerun `npm ci` after changing Node versions.

## Pandoc is missing or invalid

Pandoc is optional. Install a compatible Windows Pandoc and ensure `pandoc.exe` is on PATH, or select it in
the Pandoc dialog. The dialog validates `--version`; selecting an arbitrary `.exe` does not approve it.
Capture the displayed stderr/stdout on conversion errors. Timeouts and cancellation are reported rather
than retried with a shell.

## Structured Mode is unavailable

Check the document size. Files larger than 2 MiB deliberately remain in Source Mode to protect renderer
memory. The full Markdown remains editable and savable. For smaller documents, keep the source text and
report the smallest fixture that fails conversion.

## Image insertion fails

- Save the Markdown document before using next-to-document, `assets`, document-assets, or date-based
  destinations.
- Open a workspace before choosing the workspace asset destination.
- Check destination writability, free space, path length, and read-only media.
- For remote images, verify HTTP(S), server availability, response type/size, and timeout.
- For an existing relative image, confirm the Markdown has a saved path or an authorized workspace.

Markora renames duplicate filenames by default; an actionable image error code indicates conflicts,
invalid paths, broken references, download failure, or destination failure.

## Search or replacement misses files

Workspace search defaults to `**/*.md` and `**/*.markdown`, respects the root `.gitignore`, and always
ignores `.git`, `node_modules`, `dist`, `release`, build output, caches, and Markora backup directories.
Review include/exclude globs, custom ignored directories, case/whole-word/regex settings, scope, and the
reported truncation/failure state.

Replacement always requires a current preview, selected matches/files, explicit confirmation, and backups.
If a file changes after preview, its fingerprint check fails instead of applying stale offsets; run a new
search/preview.

## Save conflict or external change

Do not overwrite blindly. Choose Reload from disk, Keep editor version in recovery, Save a copy, or an
explicitly confirmed Overwrite. Compare the editor/disk text before destructive resolution. On a network
filesystem without watcher events, checked saves still detect fingerprint changes.

If a save fails because of permission, read-only volume, disk full, invalid destination, or long path,
Markora attempts a recovery snapshot and reports whether it succeeded.

## Recovery item is missing

Recovery stores only dirty documents at the configured interval and retains bounded history. A normal
successful save clears its recovery entry. Check the per-user Markora recovery directory before deleting
application data. A clean uninstall is configured to preserve application data.

## HTML/PDF export warning or blank preview

- Review exporter warnings for unauthorized/missing/unsupported/oversized images or an unavailable local
  Mermaid runtime.
- Remote resources are disabled by default.
- Unsafe custom print CSS or active HTML is rejected.
- Generate a fresh preview after changing options.
- Use `PDF_EXPORT_VALIDATION.md` for Chromium-specific font, link, bookmark, and pagination checks.

## Spell check has no underline or language

Enable offline spell checking, choose a language listed by Electron/Windows, and verify a per-document
override is not selecting another language. Availability depends on installed Chromium/Windows
dictionaries. Source Mode support is best effort because CodeMirror's contenteditable structure differs
from ordinary text fields.

## Packaging succeeds but install behavior is wrong

Packaging is not install verification. Check the exact installer version/hash in a clean Windows Sandbox
or VM with `CLEAN_VM_TEST_PLAN.md`. Current artifacts are unsigned, so SmartScreen warnings are expected.
Record shortcut, association, CLI, upgrade, uninstall, and settings-retention results separately.
