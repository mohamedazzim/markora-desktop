# Markora 0.2.0 release notes

Release date: 2026-07-15

Markora 0.2.0 is the first feature-completion development release after the 0.1.0 foundation. It retains the secure Electron, React, TypeScript, CodeMirror, Tiptap, and canonical Markdown architecture while filling major editor, asset, conversion, search, customization, export, recovery, accessibility, test, and Windows release gaps.

## Highlights

- Restored reproducible local Electron development with `npm ci`, `npm start`, `npm run dev`, and an actionable Windows doctor command.
- Strengthened canonical source/structured synchronization and Markdown semantic round trips.
- Added typed image asset workflows, optional safe Pandoc conversion, and Chromium spell checking.
- Added document/workspace replace, the central command palette, configurable shortcuts, writing modes, and theme customization.
- Added configurable HTML and PDF export paths with sanitized content and preview controls.
- Expanded conflict-aware saves, recovery snapshots/session restoration, accessibility checks, performance fixtures, and real Electron Playwright coverage.
- Added x64 NSIS, portable, and unpacked artifacts, plus a versioned release manifest and SHA-256 checksums.

## Windows distribution notes

- Installer: `Markora-0.2.0-Setup-x64.exe`
- Portable application: `Markora-0.2.0-Portable-x64.exe`
- Unpacked executable: `win-unpacked\Markora.exe`
- The installer registers `.md` and `.markdown`, creates a Start Menu shortcut, and creates a desktop shortcut unless `--no-desktop-shortcut` is supplied.
- User settings are deliberately retained by the uninstaller. A clean reset therefore requires removing Markora's application-data directory separately and only with the user's explicit approval.

## Known release limitations

- These development artifacts are not code-signed. Windows SmartScreen may warn before launch.
- The development-host current-user upgrade from 0.1.0, settings retention, shortcuts/associations,
  installed launch, uninstall, and reinstall passed. A clean Windows VM/Windows Sandbox run is still
  required; the development-host result is not a clean-machine certification.
- Pandoc features require a compatible local Pandoc installation and never upload document content.
