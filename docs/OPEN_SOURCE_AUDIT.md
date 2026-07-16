# Markora Desktop open-source publication audit

## Repository boundary

The public desktop repository is `mohamedazzim/markora-desktop`. It is separate
from the VS Code extension repository `mohamedazzim/markora-vscode` and from
any user workspace or application-data directory.

This repository contains source code, tests, build configuration, documentation,
and original Markora assets. It does not include Electron binaries, release
executables, `node_modules`, generated `dist` output, Graphify caches, logs,
recovery snapshots, user documents, credentials, or private VS Code extension
source.

## License and dependencies

The project is MIT-licensed. Dependency license records are maintained in
`DEPENDENCY_LICENSE_REPORT.md` and `THIRD_PARTY_LICENSES.md`. No Typora source,
Typora CSS, or Typora assets are included.

## Secret and privacy checks

Before publication, the source tree was scanned for common API-key, token,
password, private-key, and personal-path patterns. The only absolute paths in
documentation are reproducible build/test instructions or security-test
fixtures; generated analysis output and personal screenshot destinations are
excluded by `.gitignore`.

## Release boundary

Desktop binaries remain release attachments rather than Git-tracked source.
Versioned 0.2.1 metadata is preserved; 0.2.2 uses
`SHA256SUMS-0.2.2.txt` and `release-manifest-0.2.2.json`.
