# Security model

See the repository [SECURITY.md](../SECURITY.md). The trust boundary is Electron's preload API. The renderer treats Markdown as untrusted input and sanitizes rendered HTML. IPC validates input size and types, and does not provide process execution.
