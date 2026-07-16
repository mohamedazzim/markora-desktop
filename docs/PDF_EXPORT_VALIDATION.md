# PDF export validation

Markora's advanced PDF path uses a sandboxed, hidden Chromium window and `webContents.printToPDF`.
The PDF dialog covers standard and custom page sizes, orientation, margins, scale, background
graphics, header/footer templates, page numbers, metadata, table of contents, print themes,
light-theme override, print CSS, page-break controls, preview, and versioned named presets.

Automated coverage validates option bounds and translation, HTML/CSS security checks, metadata
escaping, internal table-of-contents links, local/remote image policy, Unicode and rich rendered
content preservation, cancellation, invalid renderer output, atomic destination writes, and
per-destination write failures. The canonical fixtures are:

- `tests/fixtures/export/pdf-rich.md`
- `tests/fixtures/export/pdf-rich-rendered.html`

Chromium exposes experimental switches for tagged PDFs and a heading document outline. Markora
passes those switches through when enabled. Whether a PDF viewer displays heading bookmarks varies
by the Electron/Chromium build and viewer, so bookmarks must be inspected manually and are not
claimed solely from an automated test.

## Manual visual verification

This checklist is prepared for a Windows desktop run. It is not evidence that the checks were run.
Record the application version, Electron version, Windows build, PDF viewer/version, and result for
each item when performing release validation.

1. Start Markora with `npm run dev`, open `tests/fixtures/export/pdf-rich.md`, and choose **Export
   PDF**.
2. Select **A4 report**, enable the table of contents, tagged PDF, heading outline, header, footer,
   page numbers, and background graphics. Set title to `Release Ω रिपोर्ट`, author to `Markora QA`,
   and date to the current release date.
3. Choose **Preview**. Confirm that the preview is visible, has A4 portrait proportions, and shows
   Unicode without replacement boxes. Confirm the table, image, highlighted code, KaTeX expression,
   and rendered Mermaid SVG are present. If Mermaid is still a code fence, record a renderer defect;
   PDF export deliberately does not execute document-authored JavaScript.
4. Export to a new PDF. Open it in Microsoft Edge and Adobe Acrobat Reader (when available). Confirm
   page size, orientation, all four margins, background colors, title/author/date, header/footer,
   and `current / total` page numbering.
5. Follow the table-of-contents and body internal links. Confirm they navigate to the expected
   headings in each viewer. Inspect the viewer's bookmarks/outline panel; record supported,
   unsupported, or partially generated rather than assuming bookmarks exist.
6. Select text containing `Ω रिपोर्ट`, copy it out of the PDF, and compare the text. Run the
   viewer's accessibility checker when available and record tagged-PDF results separately from
   visual appearance.
7. Repeat with Letter landscape, 12.7 mm margins, 80% scale, backgrounds disabled, and light-theme
   override. Measure page dimensions in the viewer's document properties.
8. Repeat with a custom 200 × 300 mm page. Verify both portrait and landscape dimensions.
9. Add `.markora-pdf-document h2 { color: #7c3aed; }` as print CSS and verify it in preview and the
   saved PDF. Then try an `@import`, `url(...)`, and unbalanced CSS block; each must be rejected with
   an actionable message and no output file.
10. Test page-break settings with a long document: headings selected for a new page start on a new
    page, headings stay with following content, and short tables/code blocks/blockquote content do
    not split. Oversized blocks may still split because keeping them whole is physically impossible.
11. Export a document with a relative local image. Confirm it resolves from the Markdown document
    directory. Export a document with a remote image once with remote images disabled (it must not
    make a network request) and once after explicit opt-in.
12. During a large export choose **Cancel export**. Confirm no final PDF or temporary file remains.
    Repeat to a read-only directory and confirm Markora reports the destination-specific failure.
13. Save a named preset, close/reopen the PDF dialog, apply it, then delete it. Built-in presets must
    remain available and must not be deletable.

## Automated commands

```powershell
npm run test:unit -- --run tests/unit/pdf-export.test.ts tests/unit/pdf-presets.test.ts tests/unit/pdf-export-dialog.test.tsx
npm run test:integration -- --run tests/integration/pdf-export.integration.test.ts
npm run typecheck
npm run lint
```

The real Electron PDF E2E flow must additionally select a destination through the native save
dialog and validate the emitted file begins with `%PDF-`. Renderer-only browser output is not a
substitute for that release check.
