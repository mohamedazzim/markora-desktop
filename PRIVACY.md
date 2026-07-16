# Privacy

Markora is designed as a local, offline-first application. It has no account requirement, telemetry,
analytics, advertising, crash-upload service, or cloud document backend. Document text is not sent to
an online spell-checking service.

## Data stored locally

- Markdown documents and copied image assets are stored only at locations the user selects.
- Settings, appearance profiles, shortcut profiles, spell-check preferences, and persistent dictionary
  words are stored under Electron's per-user application-data location or browser local storage.
- Dirty document snapshots, bounded recovery history, session records, and conflict/write-failure
  backups are stored under Markora's application-data location.
- Workspace replacement backups are stored inside the workspace's Markora backup area and are reported
  after replacement.
- PDF presets and search history are stored locally.
- Custom Theme Gallery packages (versioned JSON and optional CSS) are stored locally under Markora's
  Electron user-data directory and are not copied into a workspace unless the user explicitly exports a
  package there.

The Windows uninstaller is configured to preserve application data. Removing the application therefore
does not automatically remove settings and recovery data. Delete those files only after reviewing and
backing up anything that might still be needed.

## When network access can occur

Network access is not required for ordinary editing, search, recovery, local images, or local export.
It can occur when the user:

- inserts or localizes an `http:` or `https:` image URL;
- explicitly allows remote HTTP(S) images during an export; or
- chooses to open an external HTTP(S) or mail link through the operating system.

Remote servers may receive the usual network metadata, including IP address and request headers. Markora
does not attach document text or analytics to those requests. Remote-image failures are reported locally.

## Local third-party tools

Pandoc conversion, when enabled, runs the user-selected local executable and reads/writes the selected
local files. Markora does not upload conversion input. Chromium spell checking uses locally available
dictionaries.

See [SECURITY.md](SECURITY.md) for the validation and isolation controls around these operations.
