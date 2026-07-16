$ErrorActionPreference = 'Stop'
if ((node --version).TrimStart('v').Split('.')[0] -lt 20) { throw 'Node.js 20 or newer is required.' }
npm install
npm run typecheck
npm run test:unit
Write-Host 'Ready. Run npm run dev to launch Markora.'
