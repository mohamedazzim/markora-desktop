# Security

## Desktop security boundary

Markora treats the renderer as unprivileged. Electron windows use context isolation, disabled Node
integration, Chromium sandboxing, and web security. The renderer does not receive Node.js, filesystem,
process, shell, or environment objects. `electron/preload/index.ts` exposes only the typed
`window.markora` API, and the main process registers an allowlisted set of IPC channels.

Navigation outside the application is blocked and renderer-created windows are denied. User-requested
external links are passed to the operating system only after URL parsing and an `http:`, `https:`, or
`mailto:` protocol check.

## Files, paths, and IPC

- Main-process handlers validate payload types, lengths, enums, identifiers, and absolute paths with
  Zod or focused validators.
- A path-authority registry records files, workspaces, and asset files selected or created through
  trusted dialogs. Export and Pandoc handlers maintain their own short-lived approved input/output
  paths from native pickers. Privileged operations reject paths outside the applicable authority.
- Markdown writes accept only `.md` and `.markdown`, reject null-containing/non-absolute paths, compare
  disk fingerprints, and write through a same-directory temporary file and rename.
- Workspace replacement is restricted to the authorized workspace, requires a matching preview token
  and explicit confirmation, and requires a backup before each file is changed.
- Image operations bound filenames, operation identifiers, remote URL length, download size, and
  timeout; remote download and other long operations are cancellable.
- Recovery snapshots and session data have versioned schemas, size limits, path checks, retained
  history bounds, and atomic JSON writes.

The privilege boundary still requires maintenance: when a new preload method or IPC channel is added,
it must have a shared type, runtime validation in the main process, a user-authorized path model, and
focused tests.

## Rendering and content

- Application Markdown/HTML conversion uses DOMPurify or `sanitize-html` allowlists before content is
  presented or exported.
- Document-authored scripts, event handlers, privileged embeds, `javascript:` URLs, and active
  form/window content are excluded from generated export bodies. Standalone diagram exports may embed
  Markora's fixed local Mermaid runtime; it runs in strict mode under the export preview's sandbox/CSP
  and is not derived from document-authored JavaScript.
- Mermaid uses `securityLevel: 'strict'`. Diagram source is data, not executable code, and generated
  SVG is sanitized for PDF preparation.
- KaTeX renders math with error-tolerant, non-executing settings.
- Code blocks are displayed and highlighted; Markora never executes their contents.
- PDF print HTML rejects script, frame, object, embed, webview, base, form, and equivalent active
  elements before loading it in a sandboxed hidden window.
- Custom CSS is limited to 50 KB, scoped to editor roots, restricted to an allowlist of presentation
  properties, and rejects `@import`, URLs, executable legacy constructs, font-face rules, unsafe
  selectors, and nested/incomplete rules.
- Custom theme JSON/CSS packages are accepted only through versioned Zod schemas, strict theme IDs,
  hex color tokens, bounded names/descriptions/CSS, sanitization, and atomic writes below the Electron
  user-data `themes` directory. The renderer receives records through typed preload calls; it cannot
  choose an arbitrary theme storage path.

## Local executables and network access

Pandoc integration is optional and local. Markora detects or lets the user select `pandoc.exe`, validates
the selected path/version, and invokes it directly with an executable plus argument array. It never uses
a shell or concatenates document text into a command. Conversion has time, output, path, cancellation,
and diagnostic bounds.

Markora has no analytics or cloud document service. Network access can occur only for a user-supplied
remote image, remote content explicitly allowed during an export, or an external URL the user asks the
operating system to open. See [PRIVACY.md](PRIVACY.md).

## Spell checking

Spell checking uses Chromium/Electron and installed operating-system dictionaries. Markora does not send
document text to an online spell-check service. Persistent dictionary words are stored locally.

## Release security checks

Before release, run:

```powershell
npm ci
npm run verify
npm run test:integration
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Review generated artifacts, dependency licenses, and the SHA-256 manifest. Current development builds
are not code-signed; code signing and clean-machine validation are release requirements, not completed
claims.

The recorded 0.2.0 release-state checks returned zero vulnerabilities for both the full dependency tree
and `npm audit --omit=dev --audit-level=high` after removing the redundant legacy direct Electron rebuild
dependency; Electron Builder retains its fixed 4.2 toolchain.

## Reporting a vulnerability

Do not include private documents, credentials, or exploit payloads in a public issue. Contact the
maintainers privately with the affected version, reproduction conditions, security impact, and the
smallest safe proof of concept. Allow time for triage and a coordinated fix before public disclosure.
