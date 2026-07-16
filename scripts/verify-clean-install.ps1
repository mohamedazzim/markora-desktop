[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('Artifacts', 'Unpacked', 'Installed', 'All')]
  [string]$Mode = 'Artifacts',
  [string]$ReleaseDirectory = '',
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\Markora'),
  [string]$UpgradeFrom,
  [switch]$Install,
  [switch]$ExerciseLifecycle,
  [switch]$Uninstall,
  [switch]$LaunchSmokeTest,
  [switch]$RequireSignature
)

$ErrorActionPreference = 'Stop'
$script:FailureCount = 0
$script:WarningCount = 0
if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
  $ReleaseDirectory = Join-Path $PSScriptRoot '..\release'
}

function Write-Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { $script:FailureCount++; Write-Host "[FAIL] $Message" -ForegroundColor Red }
function Write-WarnResult([string]$Message) { $script:WarningCount++; Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Test-RequiredPath([string]$Path, [string]$Label) {
  if (Test-Path -LiteralPath $Path -PathType Leaf) { Write-Pass "$Label exists: $Path"; return $true }
  Write-Fail "$Label is missing: $Path"; return $false
}

function Invoke-SilentInstaller([string]$InstallerPath, [string]$Label) {
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    Write-Fail "$Label is missing: $InstallerPath"
    return $false
  }
  $arguments = @('/S', '/currentuser', "/D=$InstallDirectory")
  $process = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -eq 0) {
    Write-Pass "$Label completed at $InstallDirectory"
    return $true
  }
  Write-Fail "$Label exited with code $($process.ExitCode)."
  return $false
}

function Invoke-SilentUninstall([string]$Label) {
  $uninstaller = Join-Path $InstallDirectory 'Uninstall Markora.exe'
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    Write-Fail "$Label could not start because the uninstaller is missing: $uninstaller"
    return $false
  }
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    Write-Fail "$Label exited with code $($process.ExitCode)."
    return $false
  }
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath (Join-Path $InstallDirectory 'Markora.exe') -PathType Leaf) {
    Write-Fail "$Label returned success but Markora.exe is still installed."
    return $false
  }
  Write-Pass "$Label completed and removed the installed executable."
  return $true
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath($ReleaseDirectory)
$packagePath = Join-Path $projectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "package.json was not found at $packagePath" }
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$version = [string]$package.version
$installer = Join-Path $releaseRoot "Markora-$version-Setup-x64.exe"
$portable = Join-Path $releaseRoot "Markora-$version-Portable-x64.exe"
$unpacked = Join-Path $releaseRoot 'win-unpacked\Markora.exe'
$checksumFile = Join-Path $releaseRoot "SHA256SUMS-$version.txt"
$manifestFile = Join-Path $releaseRoot "release-manifest-$version.json"

Write-Host "Markora $version Windows verification"
Write-Host "Release directory: $releaseRoot"
Write-Host 'This script performs read-only artifact checks unless -Install, -Uninstall, or -LaunchSmokeTest is supplied.'

function Test-ArtifactSet {
  $installerExists = Test-RequiredPath $installer 'NSIS installer'
  $portableExists = Test-RequiredPath $portable 'Portable executable'
  $unpackedExists = Test-RequiredPath $unpacked 'Unpacked executable'
  [void](Test-RequiredPath $manifestFile 'Release manifest')

  if (Test-RequiredPath $checksumFile 'SHA-256 checksum file') {
    foreach ($line in Get-Content -LiteralPath $checksumFile) {
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') {
        Write-Fail "Malformed checksum line: $line"
        continue
      }
      $expected = $Matches[1].ToLowerInvariant()
      $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
      $candidate = [IO.Path]::GetFullPath((Join-Path $releaseRoot $relative))
      $releasePrefix = $releaseRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $candidate.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Fail "Checksum path escapes the release directory: $relative"
        continue
      }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Write-Fail "Checksummed artifact is missing: $candidate"
        continue
      }
      $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actual -eq $expected) { Write-Pass "SHA-256 verified: $relative" }
      else { Write-Fail "SHA-256 mismatch: $relative (expected $expected, found $actual)" }
    }
  }

  foreach ($artifact in @($installer, $portable, $unpacked)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { continue }
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact
    if ($signature.Status -eq 'Valid') { Write-Pass "Authenticode signature is valid: $artifact" }
    elseif ($RequireSignature) { Write-Fail "Authenticode signature is $($signature.Status): $artifact" }
    else { Write-WarnResult "Artifact is not code-signed ($($signature.Status)): $artifact" }
  }

  if ($installerExists) {
    $fileVersion = (Get-Item -LiteralPath $installer).VersionInfo.ProductVersion
    if ($fileVersion -and $fileVersion.StartsWith($version)) { Write-Pass "Installer product version is $fileVersion" }
    else { Write-WarnResult "Installer version resource '$fileVersion' could not be matched to $version" }
  }
  return ($installerExists -and $portableExists -and $unpackedExists)
}

function Test-InstalledState {
  $installedExecutable = Join-Path $InstallDirectory 'Markora.exe'
  if (-not (Test-RequiredPath $installedExecutable 'Installed executable')) { return }

  $startMenuCandidates = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Markora.lnk'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Markora.lnk')
  )
  if ($startMenuCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }) { Write-Pass 'Start Menu shortcut exists.' }
  else { Write-Fail 'Start Menu shortcut was not found in the current-user or all-users locations.' }

  # Desktop can be redirected (for example to OneDrive), so resolve the Windows
  # known folders instead of assuming they live directly below the user profile.
  $desktopCandidates = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Markora.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Markora.lnk')
  )
  if ($desktopCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }) { Write-Pass 'Desktop shortcut exists.' }
  else { Write-WarnResult 'Desktop shortcut is absent. This is valid when the installer was run with --no-desktop-shortcut.' }

  foreach ($extension in @('md', 'markdown')) {
    $association = $null
    foreach ($scope in @('Registry::HKEY_CURRENT_USER', 'Registry::HKEY_LOCAL_MACHINE')) {
      $extensionKey = Join-Path $scope "Software\Classes\.$extension"
      if (Test-Path -LiteralPath $extensionKey) {
        $value = (Get-Item -LiteralPath $extensionKey).GetValue('')
        if ($value) { $association = @{ Scope = $scope; Class = [string]$value }; break }
      }
    }
    if (-not $association) { Write-Fail ".$extension file association is not registered."; continue }
    $commandKey = Join-Path $association.Scope "Software\Classes\$($association.Class)\shell\open\command"
    $command = if (Test-Path -LiteralPath $commandKey) { (Get-Item -LiteralPath $commandKey).GetValue('') } else { $null }
    if ($command -and ([string]$command).Contains('Markora.exe') -and ([string]$command).Contains('%1')) {
      Write-Pass ".$extension Open With command is registered: $command"
    } else { Write-Fail ".$extension association has no valid Markora open command." }
  }
}

function Invoke-LaunchSmoke([string]$Executable, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { Write-Fail "$Label cannot launch because the executable is missing."; return }
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ("markora-release-check-" + [guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $testRoot)
  $process = $null
  try {
    $userData = Join-Path $testRoot 'user-data'
    [void](New-Item -ItemType Directory -Path $userData)
    $firstFile = Join-Path $testRoot 'first.md'
    $secondFile = Join-Path $testRoot 'unicode-नोट.markdown'
    Set-Content -LiteralPath $firstFile -Value '# First launch argument' -Encoding UTF8
    Set-Content -LiteralPath $secondFile -Value '# Second launch argument' -Encoding UTF8
    $arguments = @("--user-data-dir=$userData", $firstFile, $secondFile)
    $process = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru
    Start-Sleep -Seconds 5
    if ($process.HasExited) { Write-Fail "$Label exited during its launch smoke test with code $($process.ExitCode)." }
    else { Write-Pass "$Label remained responsive after launch with multiple Markdown arguments." }
  } catch {
    Write-Fail "$Label launch smoke test failed: $($_.Exception.Message)"
  } finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Test-UpgradePath([string]$PriorInstaller) {
  if (-not (Test-Path -LiteralPath $PriorInstaller -PathType Leaf)) {
    Write-Fail "Prior installer is missing: $PriorInstaller"
    return
  }
  if (-not $PSCmdlet.ShouldProcess($InstallDirectory, "Upgrade Markora from $PriorInstaller to $installer")) { return }

  $existingUninstaller = Join-Path $InstallDirectory 'Uninstall Markora.exe'
  if (Test-Path -LiteralPath $existingUninstaller -PathType Leaf) {
    if (-not (Invoke-SilentUninstall 'Pre-upgrade baseline uninstall')) { return }
  }
  if (-not (Invoke-SilentInstaller $PriorInstaller 'Prior-version installation')) { return }

  $installedExecutable = Join-Path $InstallDirectory 'Markora.exe'
  if (-not (Test-RequiredPath $installedExecutable 'Prior-version executable')) { return }
  if ($LaunchSmokeTest) { Invoke-LaunchSmoke $installedExecutable 'Prior installed application' }

  $userData = Join-Path $env:APPDATA 'Markora'
  $settingsPath = Join-Path $userData 'settings.json'
  $settingsExisted = Test-Path -LiteralPath $settingsPath -PathType Leaf
  $originalSettings = if ($settingsExisted) { [IO.File]::ReadAllBytes($settingsPath) } else { $null }
  [void](New-Item -ItemType Directory -Path $userData -Force)
  $testSettings = '{"theme":"dark","fontSize":18,"lineHeight":1.7,"contentWidth":840,"wordWrap":true,"autosaveSeconds":15,"safeExternalLinks":true}'
  [IO.File]::WriteAllText($settingsPath, $testSettings, [Text.UTF8Encoding]::new($false))
  $expectedSettingsHash = (Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash

  try {
    if (-not (Invoke-SilentInstaller $installer "Upgrade installation to $version")) { return }
    $actualSettingsHash = if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
      (Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash
    } else { '' }
    if ($actualSettingsHash -eq $expectedSettingsHash) {
      Write-Pass 'User settings were preserved byte-for-byte across the installer upgrade.'
    } else {
      Write-Fail 'User settings were deleted or changed during the installer upgrade.'
    }
    $installedVersion = (Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion
    if ($installedVersion -and $installedVersion.StartsWith($version)) {
      Write-Pass "Installed executable was upgraded to $installedVersion."
    } else {
      Write-Fail "Installed executable version '$installedVersion' does not match $version."
    }
    Test-InstalledState
    if ($LaunchSmokeTest) { Invoke-LaunchSmoke $installedExecutable 'Upgraded installed application' }
  } finally {
    if ($settingsExisted) { [IO.File]::WriteAllBytes($settingsPath, $originalSettings) }
    elseif (Test-Path -LiteralPath $settingsPath -PathType Leaf) { Remove-Item -LiteralPath $settingsPath -Force }
  }
}

$artifactsValid = Test-ArtifactSet

if ($UpgradeFrom) {
  Test-UpgradePath ([IO.Path]::GetFullPath($UpgradeFrom))
}

if ($Install -and -not $UpgradeFrom) {
  if (-not $artifactsValid) { Write-Fail 'Installation was skipped because required artifacts are invalid.' }
  elseif ($PSCmdlet.ShouldProcess($InstallDirectory, "Install Markora $version from $installer")) {
    [void](Invoke-SilentInstaller $installer "Silent current-user installation of Markora $version")
  }
}

if ($Mode -in @('Unpacked', 'All')) { [void](Test-RequiredPath $unpacked 'Unpacked executable') }
if ($Mode -in @('Installed', 'All') -or $Install) { Test-InstalledState }
if ($LaunchSmokeTest) {
  if ($Mode -in @('Unpacked', 'All', 'Artifacts')) { Invoke-LaunchSmoke $unpacked 'Unpacked application' }
  if ($Mode -in @('Unpacked', 'All', 'Artifacts')) { Invoke-LaunchSmoke $portable 'Portable application' }
  if ($Mode -in @('Installed', 'All') -or $Install) { Invoke-LaunchSmoke (Join-Path $InstallDirectory 'Markora.exe') 'Installed application' }
}

if ($ExerciseLifecycle) {
  if ($PSCmdlet.ShouldProcess($InstallDirectory, 'Uninstall and reinstall the current Markora release')) {
    if (Invoke-SilentUninstall 'Release lifecycle uninstall') {
      if (Invoke-SilentInstaller $installer 'Release lifecycle reinstall') {
        Test-InstalledState
        if ($LaunchSmokeTest) {
          Invoke-LaunchSmoke (Join-Path $InstallDirectory 'Markora.exe') 'Reinstalled application'
        }
      }
    }
  }
}

if ($Uninstall) {
  if ($PSCmdlet.ShouldProcess($InstallDirectory, 'Uninstall Markora')) {
    [void](Invoke-SilentUninstall 'Silent uninstall')
  }
}

Write-Host "Verification finished: $script:FailureCount failure(s), $script:WarningCount warning(s)."
if ($script:FailureCount -gt 0) { exit 1 }
