# Markora 0.2.2 release notes

Release date: 2026-07-16

Markora 0.2.2 is a focused runtime patch for Markdown link activation.

## Highlights

- Relative links open documents in the same folder, nested folders, and parent
  folders.
- Encoded and Unicode filenames resolve without losing their original names.
- `file:///` links are supported subject to the existing authorized-workspace
  policy.
- Same-document and cross-document heading fragments are normalized and
  navigated after the target editor is ready.
- HTTP(S) and mailto links continue through the validated external-link IPC;
  unsafe protocols are rejected.
- Enter activates a link when the caret is inside a linked span.

## Verification

- Unit link-resolution coverage includes 11 tests.
- Targeted Electron E2E coverage verifies encoded filenames and cross-document
  heading navigation.
- Existing 0.2.1 artifacts are preserved; 0.2.2 artifacts use new filenames.
