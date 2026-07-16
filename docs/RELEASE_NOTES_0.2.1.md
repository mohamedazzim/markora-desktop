# Markora 0.2.1 release notes

Release date: 2026-07-16

Markora 0.2.1 is a desktop patch release focused on modal readability and
accessibility. It fixes the portal/theme boundary that made Edit link and
other dialogs inherit missing or document-only colors.

## Highlights

- Opaque, token-driven shared modal surfaces and restrained light/dark overlays.
- Application-only dialog tokens mirrored to the body portal; document themes
  and custom Markdown CSS no longer recolor dialogs.
- Accessible Edit link layout with initial focus, Escape/Enter handling,
  validation, safe URI schemes, and explicit Remove link action.
- Regression coverage for unit, axe, Electron Playwright, Classic White, and
  Midnight visual flows.
- VS Code-style tab context actions: Close, Close Others, Close All to the
  Right, and Close All with guarded unsaved-document handling.
- Collapsed workspace trees with empty-folder handling, unsupported-file
  feedback, relative Markdown-link navigation, and Mermaid fence restoration.

## Windows distribution notes

- Installer: `Markora-0.2.1-Setup-x64.exe`
- Portable application: `Markora-0.2.1-Portable-x64.exe`
- Unpacked executable: `win-unpacked/Markora.exe`
