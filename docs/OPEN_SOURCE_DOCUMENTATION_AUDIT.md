# Open-source documentation audit

Audit date: 2026-07-16  
Repository: [mohamedazzim/markora-desktop](https://github.com/mohamedazzim/markora-desktop)  
Reviewed release: `0.2.2`

## Findings and actions

| Area                 | Finding                                                                                                                                          | Action in this pass                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| README               | The previous page described the application but did not provide a release download table, checksum instructions, badges, or a public screenshot. | Rewritten as an end-user and contributor landing page with fixed `0.2.2` links and a public-safe Structured Mode screenshot.        |
| Release links        | Installer, portable build, checksums, manifest, release page, and latest page were checked with public HTTP requests.                            | Links are now centralized in the README and the release-process checklist explains the version-update step.                         |
| Badges               | CI was available; CodeQL was not configured.                                                                                                     | Added a CodeQL workflow and a badge pointing at that workflow.                                                                      |
| Screenshots          | No public-safe screenshot was referenced by the README.                                                                                          | Added `media/desktop-mermaid.png`; it contains no user paths, usernames, or private documents.                                      |
| Licensing            | MIT, dependency report, and third-party license documentation already existed.                                                                   | README now links to all three and does not claim licenses that were not audited.                                                    |
| Security and privacy | Root policies existed but were not prominent from the product page.                                                                              | README links directly to `SECURITY.md` and `PRIVACY.md`; the limitations around unsigned binaries and optional Pandoc are explicit. |
| Contributor guidance | Contribution and development instructions existed but were difficult to discover.                                                                | README links to contribution, testing, architecture, and release documentation.                                                     |
| Unsupported claims   | Clean Windows VM validation and Pandoc availability vary by machine.                                                                             | README states that a clean VM/Sandbox pass was not performed and Pandoc is optional.                                                |
| Public separation    | Desktop and VS Code repositories are separate.                                                                                                   | No desktop source was copied to `markora-markdown-editor`; related-project links are explicit.                                      |

## Files reviewed

`README.md`, `CHANGELOG.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md`,
`THIRD_PARTY_LICENSES.md`, `DEPENDENCY_LICENSE_REPORT.md`, package manifests, workflows,
release documentation, feature matrix, known limitations, and architecture documentation.

## Verification boundaries

- The published `v0.2.2` artifacts were not replaced or renamed.
- No new desktop version, release, or tag was created for this documentation pass.
- Public release URLs returned HTTP 200 during the audit.
- The installed/unpacked application was used to capture the screenshot; a clean Windows VM or
  Sandbox was not available, so clean-install claims remain intentionally unmade.
- Windows binaries are not code-signed in the current release. Users should verify the published
  SHA-256 checksum before installation.

## Future maintenance checklist

For each desktop release, update the version in the README download table, screenshot caption if
needed, `CHANGELOG.md`, release verification record, and the fixed asset names in the release
manifest. Verify every URL with a public GET request, regenerate checksums, and review the README
from a clean GitHub session before tagging.
