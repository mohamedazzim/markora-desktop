# Import and export

Markora has native rendered HTML/PDF export and optional local Pandoc conversion. All privileged path and
process work occurs in the Electron main process through typed preload methods.

## HTML export

The HTML dialog supports:

- styled or unstyled content;
- standalone document or fragment output;
- embedded CSS or omitted CSS;
- optional local image embedding as data URLs;
- table of contents;
- Markora light/dark, GitHub light/dark, and print themes;
- syntax highlighting;
- KaTeX rendering;
- local strict-mode Mermaid rendering/runtime;
- stable heading identifiers and internal TOC links;
- title, author, description, date, and language metadata;
- UTF-8 output; and
- a sandboxed preview before writing.

The exporter parses front matter for supported metadata, applies explicit dialog metadata over it, warns
about missing/unauthorized/oversized/unsupported images and unavailable optional runtimes, and sanitizes
the generated body. Standalone output has a restrictive Content Security Policy.

Image embedding requires a saved source path or authorized workspace context for relative references.
Images outside approved roots are not read merely because Markdown names them.

## PDF export

The PDF dialog supports:

- A0-A6, Letter, Legal, Tabloid, Ledger, and bounded custom page sizes;
- portrait/landscape, margins, scale, background graphics;
- header/footer templates and page numbers;
- title, author, and date;
- optional table of contents;
- document, light, dark, and sepia print themes plus light override;
- sanitized scoped print CSS;
- configurable page breaks/avoidance;
- preview without writing;
- built-in and named user presets;
- cancellation; and
- optional Chromium tagged-PDF/document-outline flags.

Markora prepares sanitized rendered HTML (including syntax-highlighted code, KaTeX, sanitized Mermaid SVG,
tables, links, and images) and loads it in a hidden sandboxed BrowserWindow before calling
`webContents.printToPDF`. The output path comes from a native save dialog and is written atomically.

Structural tests and a real Chromium E2E prove PDF creation. Chromium ultimately determines bookmark,
tagging, internal-link, font, and pagination behavior, so use `PDF_EXPORT_VALIDATION.md` for the manual
release-candidate inspection. Do not claim those visual/semantic details from a `%PDF-` assertion alone.

## Pandoc export

When a validated local Pandoc executable is available, Markora can export Markdown to:

- DOCX
- ODT
- RTF
- EPUB
- LaTeX (`.tex`)
- MediaWiki text
- plain text

The dialog reports detection status/version/path, supports manual executable selection, format and output
selection, presets, progress, cancellation, and detailed stdout/stderr on failure. The main process writes
a bounded temporary Markdown input, invokes Pandoc directly without a shell, and removes the temporary
file afterward.

## Pandoc import

The optional importer supports:

- DOCX
- ODT
- RTF
- HTML
- LaTeX where practical

The input must be selected through the native picker. Import first creates a Markdown preview in a bounded
temporary location; the user can inspect warnings/diagnostics before accepting it into the editor.

Pandoc is not bundled and was absent from this development environment. Mocked executable tests are
present, but a real import/export smoke test is Blocked until Pandoc is installed.

## Security and privacy

- No export/import operation uses shell command concatenation.
- Pandoc executable, input, and output paths must be approved by their dedicated pickers/detection path.
- Arguments, paths, formats, metadata lengths, output size, runtime, and operation IDs are validated.
- Markdown/HTML/SVG/custom print CSS are sanitized before privileged rendering.
- Remote images are disabled by default and can cause network requests only after an explicit option or
  localization action.
- Document text is not uploaded to a conversion service.
