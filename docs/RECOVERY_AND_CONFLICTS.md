# Recovery, sessions, and disk conflicts

Markora keeps editor state authoritative in the renderer's `CanonicalDocument`. The main process owns disk fingerprints, checked writes, filesystem observation, retained backups, recovery snapshots, and session metadata. The two sides communicate only through the typed preload API.

## Safe save lifecycle

Every opened Markdown file receives a SHA-256 fingerprint containing its byte length and modification time. A normal save supplies the fingerprint observed when the document was opened or last explicitly reloaded. The main process writes UTF-8 text to a same-directory temporary file, flushes the file, checks the destination fingerprint again, and replaces the destination. Saves targeting the same file are serialized.

If the disk bytes no longer match, the operation returns a typed conflict instead of writing. If a write fails, the operation returns an actionable failure (`READ_ONLY`, `PERMISSION_DENIED`, `DISK_FULL`, `PATH_TOO_LONG`, `INVALID_DESTINATION`, or `WRITE_FAILED`) and attempts to retain the editor text as a recovery snapshot.

Existing destinations without a known baseline are never replaced silently. They require either the native Save As overwrite confirmation or the explicit two-step overwrite action in the conflict dialog.

Before any normal replacement or confirmed overwrite of an existing file, Markora retains a timestamped backup under the application-data `backups` directory. Backup history is isolated per document and bounded to 20 copies.

## External changes

The main process observes the containing directory for every open file and emits typed events for:

- modified files;
- same-directory renames, including a rename after an observed content edit; and
- deletion or movement outside the observed directory.

The renderer automatically accepts a disk version only when it is semantically unchanged, already matches the editor, or contains only a safe line-ending change in a clean document. Every other event opens the conflict dialog.

The conflict dialog provides:

- **Reload from disk**: accepts the observed fingerprint and replaces editor text;
- **Keep editor version**: marks the editor dirty and retains a conflict snapshot;
- **Compare Versions**: shows a bounded unified diff or aligned editor/disk side-by-side view, with
  last-known, disk-modified, and detected timestamps;
- **Save a copy**: uses the native path chooser and keeps the original disk file; and
- **Overwrite disk version**: requires a second explicit confirmation and retains a backup first.

All conflict and recovery surfaces use the shared renderer Dialog primitive. It owns the modal portal,
background inerting, focus trap/restoration, and Escape behavior; the destructive replacement confirmation
is deliberately nested and cannot be accepted by pressing Enter or Escape accidentally.

For a detected rename, Reload follows the renamed file and Overwrite replaces the renamed destination, not the obsolete original path. For deletion, Reload is disabled; Save a copy and confirmed recreation remain available.

## Autosave and session restoration

Dirty documents receive local JSON snapshots. Each document retains up to 10 historical snapshots plus `latest.json`. Snapshot and session writes use flushed temporary files and atomic replacement, and concurrent writes are serialized. Corrupt entries are skipped independently so one damaged snapshot cannot hide other recoverable documents.

The versioned session record stores up to 100 tab descriptors, the active tab, editor mode, and optional workspace path. It never stores privileged handles. At launch, the Recovery Center combines the session with latest dirty snapshots and lets the user restore or explicitly discard individual items. Snapshots are cleared only after a successful save, explicit Reload, or explicit discard; opening the Recovery Center does not delete them.

Session metadata is persisted after editor activity, at the configured autosave interval, and on the renderer's shutdown notification. All snapshot content remains local. Markora does not send document text to an online recovery service.

## Filesystem limitations

Some network and virtual filesystems do not support reliable `fs.watch` notifications. Checked saves still protect against overwriting a changed file, and Markora checks again whenever a save is attempted. Rename detection searches up to 2,000 Markdown files in the original directory and therefore does not infer moves to unrelated directories.

Renderer shutdown IPC is best-effort because Windows may terminate a process abruptly. Periodic and activity-debounced snapshots are the durable protection for that case.

## Automated verification

Recovery-specific automated coverage includes:

- atomic write, fingerprint, backup, retention, cleanup, Unicode, CRLF, deletion, and rename tests;
- recovery store validation, corruption isolation, bounded history, concurrent writes, session validation, and write-failure tests;
- file lifecycle tests for modified, renamed, deleted, read-only/permission-style failures, duplicate observations, explicit overwrite, and concurrent saves;
- strict IPC, path-authority, native-dialog, compatibility, recovery-on-failure, session, and event tests;
- renderer controller and accessible dialog interaction tests; and
- real-filesystem integration journeys plus a sandboxed preload bridge integration suite.

The six dedicated recovery/atomic-write unit files contain 73 tests. The complete integration suite
contains 42 tests, including 16 recovery/preload integration tests. Accessibility coverage includes
axe-core checks and focus-management tests for both recovery dialogs.
