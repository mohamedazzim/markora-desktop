[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:Failures = 0
$script:Warnings = 0

function Write-Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { $script:Warnings++; Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Fail([string]$Message) { $script:Failures++; Write-Host "[FAIL] $Message" -ForegroundColor Red }
function Test-Command([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }

Write-Host 'Markora development environment doctor' -ForegroundColor Cyan
Write-Host "Workspace: $PSScriptRoot\.."

try {
  $nodeVersion = (& node --version).Trim().TrimStart('v')
  $nodeMajor = [int]$nodeVersion.Split('.')[0]
  if ($nodeMajor -ge 22 -and $nodeMajor -le 24) { Write-Pass "Node.js $nodeVersion (supported range: 22-24)" }
  else { Write-Fail "Node.js $nodeVersion is unsupported. Install Node.js 22 LTS or 24." }
} catch { Write-Fail 'Node.js is not on PATH. Install Node.js 22 LTS or 24.' }

try {
  $npmVersion = (& npm --version).Trim()
  if ([version]$npmVersion -ge [version]'10.0.0') { Write-Pass "npm $npmVersion" }
  else { Write-Fail "npm $npmVersion is too old. Upgrade to npm 10 or newer." }
} catch { Write-Fail 'npm is not on PATH.' }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$required = @('package.json', 'package-lock.json', 'electron', 'src', 'scripts', 'node_modules')
foreach ($item in $required) {
  if (Test-Path (Join-Path $root $item)) { Write-Pass "Required path exists: $item" }
  else { Write-Fail "Required path missing: $item. Run npm ci if node_modules is missing." }
}

if (Test-Path (Join-Path $root 'package-lock.json')) {
  Push-Location $root
  try {
    & npm ls --depth=0 --silent *> $null
    if ($LASTEXITCODE -eq 0) { Write-Pass 'package-lock.json and installed dependency tree are consistent' }
    else { Write-Fail 'Dependency tree does not match package-lock.json. Run npm ci --foreground-scripts.' }
  } finally { Pop-Location }
}

$electronPackage = Join-Path $root 'node_modules\electron\package.json'
$electronPathFile = Join-Path $root 'node_modules\electron\path.txt'
if (Test-Path $electronPackage) {
  $electronVersion = (Get-Content $electronPackage -Raw | ConvertFrom-Json).version
  Write-Pass "Electron package $electronVersion is installed"
  if (Test-Path $electronPathFile) {
    $relativeElectron = (Get-Content $electronPathFile -Raw).Trim()
    $electronExe = Join-Path (Join-Path $root 'node_modules\electron\dist') $relativeElectron
    if (Test-Path $electronExe) {
      Write-Pass "Electron executable: $electronExe"
      try {
        $reported = ((& $electronExe --version 2>&1 | Out-String).Trim())
        if ($LASTEXITCODE -eq 0) { Write-Pass "Electron executable runs$(if ($reported) { ": $reported" } else { '' })" }
        else { Write-Fail "Electron executable returned exit code $LASTEXITCODE." }
      } catch { Write-Fail "Electron executable could not run: $($_.Exception.Message)" }
    } else { Write-Fail "Electron executable is missing at $electronExe. Run npm rebuild electron --foreground-scripts." }
  } else { Write-Fail 'Electron path.txt is missing. Run npm rebuild electron --foreground-scripts.' }
} else { Write-Fail 'Electron package is missing. Run npm ci --foreground-scripts.' }

foreach ($tool in @('node_modules\vite\bin\vite.js', 'node_modules\typescript\bin\tsc', 'node_modules\electron-builder\out\cli\cli.js')) {
  if (Test-Path (Join-Path $root $tool)) { Write-Pass "Build tool available: $tool" } else { Write-Fail "Build tool missing: $tool" }
}

Push-Location $root
try {
  $productionPackages = @(& npm ls --omit=dev --parseable --all 2>$null | Select-Object -Skip 1)
  $nativeModules = @($productionPackages | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Recurse -Filter '*.node' -File -ErrorAction SilentlyContinue
  } | Select-Object -ExpandProperty FullName -Unique)
} finally { Pop-Location }
if ($nativeModules.Count -eq 0) { Write-Pass 'Production dependency tree has no native Node add-ons requiring an Electron ABI rebuild' }
else { Write-Warn "$($nativeModules.Count) production native add-on(s) detected. Run npx electron-rebuild and exercise their Electron code paths after Electron upgrades." }

$pandoc = Get-Command pandoc -ErrorAction SilentlyContinue
if ($pandoc) { try { Write-Pass "Pandoc found: $($pandoc.Source) - $((& pandoc --version | Select-Object -First 1).Trim())" } catch { Write-Warn "Pandoc exists at $($pandoc.Source) but version detection failed." } }
else { Write-Warn 'Pandoc is optional and was not found. Install it or configure its path in Markora for document conversion.' }

$appDataRoot = Join-Path $env:APPDATA 'Markora-doctor'
try {
  New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null
  $probe = Join-Path $appDataRoot 'write-test.tmp'
  Set-Content -LiteralPath $probe -Value 'ok' -Encoding UTF8
  Remove-Item -LiteralPath $probe -Force
  Remove-Item -LiteralPath $appDataRoot -Force -ErrorAction SilentlyContinue
  Write-Pass "Application-data location is writable: $env:APPDATA"
} catch { Write-Fail "Application-data location is not writable: $($_.Exception.Message)" }

$osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
$processArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
if ($osArchitecture -eq $processArchitecture) { Write-Pass "Windows/process architecture: $osArchitecture" }
else { Write-Warn "Windows architecture is $osArchitecture but Node process is $processArchitecture. Use matching x64 tools for release builds." }

Write-Host "Doctor complete: $script:Failures failure(s), $script:Warnings warning(s)." -ForegroundColor Cyan
if ($script:Failures -gt 0) { exit 1 }
