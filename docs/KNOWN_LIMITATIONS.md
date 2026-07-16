# Known limitations

These are current user-visible or release-verification limitations. Planned work that is already
implemented is intentionally not listed.

## Editing and Markdown

- Structured Mode is limited to documents of 2 MiB or less. Larger documents remain fully editable and
  savable in Source Mode.
- A structured edit intentionally normalizes Markdown formatting as documented in
  `MARKDOWN_NORMALIZATION.md`; exact provider-specific formatting requires Source Mode.
- Reference links, footnotes, inline math, front matter, and raw HTML are preserved/tested but do not all
  have specialized visual management dialogs.
- Safe raw HTML is not executed. Complex or unsupported provider-specific Markdown should be edited in
  Source Mode.
- Mermaid has strict rendering and theme support but no pan/zoom, diagram image export, or exhaustive
  provider-extension support.

## Images and network content

- Asset destinations that depend on a document directory require the document to be saved first; the
  workspace destination requires an open workspace.
- Remote image download can fail because of the network, server response, timeout, type/size policy, or
  destination permissions. Markora reports the failure rather than silently retaining a broken copy.
- HTML/PDF remote images are disabled unless the relevant export option explicitly allows or embeds them.

## Pandoc and spell checking

- Pandoc is optional and not bundled. It was not installed in the verification environment, so real
  import/export remains Blocked even though mocked executable tests cover detection, arguments,
  cancellation, timeout, and diagnostics.
- Importing LaTeX is best effort and depends on the selected Pandoc version and source complexity.
- Native misspelling underlines, installed-language availability, and context-menu suggestions depend on
  Chromium and Windows dictionaries. These require a manual Windows check beyond policy/component tests.

## Export

- Chromium controls actual PDF bookmark/outline, tagged-PDF, internal-link, and pagination fidelity.
  Options are passed where supported, but representative artifacts still require the manual validation
  procedure in `PDF_EXPORT_VALIDATION.md`.
- Visual PDF comparison for Unicode fonts, very large tables/images, KaTeX, and Mermaid is not replaceable
  by structural byte/header assertions.
- Remote resources can make export nondeterministic and are disabled by default.

## Recovery and application lifecycle

- Recovery/session/conflict integration and its focused real-Electron flows are implemented. Recovery is
  still a safety net rather than version control; retained history is deliberately bounded.
- File watching can be unavailable on some network filesystems. Fingerprint-checked saves continue to
  prevent silent overwrite even when watcher notifications are unavailable.
- Rename detection is heuristic and limited to matching Markdown files in the same directory.
- Closing a dirty tab still uses a basic confirmation experience in some paths.

## Windows release

- Development artifacts are not code-signed and can trigger Windows SmartScreen warnings.
- No automatic update feed is configured.
- A real clean Windows VM/Windows Sandbox install has not been performed.
- The development-host 0.1.0-to-0.2.0 current-user upgrade, settings retention, Start Menu and redirected
  Desktop shortcuts, uninstall/reinstall, Open With, file associations, and installed-app launch passed.
  This is not a substitute for repeating the matrix in a clean Windows VM.

## Accessibility and performance

- Automated accessibility tests do not replace Narrator/NVDA, Windows Contrast Theme, reduced-motion,
  reflow, native-menu, and 200% scaling checks. Those manual checks have not been performed.
- Complex Mermaid/KaTeX output has a named wrapper but no author-provided long-description system.
- Performance measurements are machine-specific. Fixture presence alone is not a performance result;
  consult `PERFORMANCE_REPORT.md` for the actual run and any deferred/failed scenarios.
- The Vite production renderer entry chunk is 2,652.57 KB minified (784.68 KB gzip). Feature-level code
  splitting is still needed to reduce initial renderer download/parse cost and bound future bundle growth.
