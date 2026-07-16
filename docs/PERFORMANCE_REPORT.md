# Performance report

Report date: 2026-07-15  
Markora: 0.2.0  
Electron: 43.1.0  
Node.js: 24.16.0 x64

## Test system

- Windows 11 Home Single Language, build 26200
- AMD Ryzen 7 7840HS, 8 cores / 16 logical processors
- 16,030,588 KiB visible physical memory (approximately 15.3 GiB)
- Local workspace on `C:`
- Vitest performance workloads execute serially. Real startup and Mermaid timings come from an actual Electron process launched by Playwright.

These are measurements from this machine, not portable performance guarantees. Durations are wall-clock
times from one release-state run and can vary with power mode, storage, virus scanning, thermal state, and
background activity.

## Results

| Workload                                           |                    Actual result | Verification                                      |
| -------------------------------------------------- | -------------------------------: | ------------------------------------------------- |
| Canonical model open, 1 MiB                        |                          4.43 ms | Passed                                            |
| Canonical model open, 5 MiB                        |                         29.86 ms | Passed                                            |
| Canonical model open, 10 MiB                       |                         43.48 ms | Passed                                            |
| Source to Structured transform, 1 MiB              |                      1,852.85 ms | Passed                                            |
| Structured to Source transform, 1 MiB              |                      4,133.75 ms | Passed                                            |
| 5 MiB mode-policy decision                         |                          6.08 ms | Passed; Source-only policy applied                |
| 10 MiB mode-policy decision                        |                         12.35 ms | Passed; Source-only policy applied                |
| 500 headings and 500 images transform              |                         50.18 ms | Passed                                            |
| 100 Mermaid fences transform                       |                          7.27 ms | Passed; parsing only                              |
| First Mermaid render in real Electron              |                        266.09 ms | Passed                                            |
| 50 tabs plus 500 open/close cycles                 |                         74.08 ms | Passed                                            |
| Heap growth in that tab-cycle workload             |                  1,118,472 bytes | Passed bounded-growth assertion                   |
| 100 canonical typing updates                       | 6.18 ms total / 0.062 ms average | Passed                                            |
| Create 5,000-file fixture                          |                      1,980.68 ms | Informational setup                               |
| Search 5,000 files                                 |                        545.08 ms | Passed; 5,000 files searched, 50 matches          |
| Create 10,000-file fixture                         |                      3,951.36 ms | Informational setup                               |
| Search 10,000 files                                |                      1,037.96 ms | Passed; 10,000 files searched, 100 matches        |
| Standalone rich HTML export, 1 MiB                 |                        647.10 ms | Passed; 8,323 headings, math and Mermaid retained |
| Real Electron startup to visible application shell |                      1,074.64 ms | Passed                                            |

Machine-readable evidence is written to:

- `test-results/performance-results.json`
- `test-results/e2e-timing.json`
- `test-results/e2e-results.json`

## Large-document policy

An earlier unbounded attempt to construct the 10 MiB Structured Mode projection exhausted the approximately
4 GiB V8 heap. That failure was not hidden or converted into a misleading timing. Markora now measures the
UTF-8 byte length before transforming: documents above 2 MiB open in Source Mode and Structured Mode is
disabled with an explanation. The canonical model still opens and saves 5 MiB and 10 MiB documents, while
the structured serializer processes top-level HTML in bounded chunks.

The current policy is a safety boundary, not proof that very large documents are visually instantaneous.
CodeMirror remains the supported editor for documents over 2 MiB.

## Performance architecture

- Workspace search and replace run through a cancellable background service with bounded concurrency,
  ignored-directory defaults, result limits, and replace previews.
- Structured conversion is gated before expensive AST/DOM work.
- Canonical undo history has a 64 MiB memory budget.
- Mermaid rendering is lazy at the node-view boundary; the performance fixture transforms fences without
  eagerly rendering every diagram.
- Workspace result lists and large trees use bounded results and progressive expansion; full tree virtualization
  is not yet implemented.
- Export and Pandoc operations expose cancellation and timeouts; PDF uses an isolated hidden render window.

## Commands

```powershell
npm run test:performance
npm run test:e2e -- tests/e2e/timing.e2e.spec.ts
```

The final release verification reruns both commands. If final measurements differ, the JSON reports produced
by that run are authoritative and this table must be refreshed before publishing artifacts.

## Remaining validation limits

- The test records model-update cost, not hardware-instrumented keyboard-to-paint latency.
- Chromium process working-set growth over multi-hour sessions was not profiled.
- A 10,000-file workspace was generated and searched, but its complete tree was not kept expanded in the UI.
- Mermaid timing covers one representative diagram, not hundreds rendered simultaneously.
- The Vite production renderer entry chunk is **2,652.57 KB minified / 784.68 KB gzip**. It works in the
  measured release state, but route/feature-level code splitting remains future performance work.
- No clean-VM performance comparison has been performed.
