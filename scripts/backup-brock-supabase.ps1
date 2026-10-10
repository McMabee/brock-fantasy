[CmdletBinding()]
param(
  [string]$BackupRoot = 'D:\Brock Fantasy',
  [switch]$CopyOffsite,
  [switch]$VerifyRestore
)

$ErrorActionPreference = 'Stop'
$projectRef = 'fdovowiihxowzatewxgv'
$backupRootPath = [IO.Path]::GetFullPath($BackupRoot)
$privatePath = Join-Path $backupRootPath 'Private'
$workRoot = Join-Path $privatePath 'work'
$repository = Join-Path $backupRootPath 'Backups\restic-local'
$restic = Join-Path $backupRootPath 'Tools\restic.exe'
$rclone = Join-Path $backupRootPath 'Tools\rclone.exe'
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runName = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N')
$runPath = Join-Path $workRoot $runName
$restorePath = Join-Path $workRoot ($runName + '-restore')
$oldPassword = $env:RESTIC_PASSWORD
$oldFromPassword = $env:RESTIC_FROM_PASSWORD
$oldRcloneConfig = $env:RCLONE_CONFIG
$oldPath = $env:PATH

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  # Capture output: provider commands can contain sensitive details on failure.
  # Windows PowerShell 5.1 turns harmless native stderr into terminating errors
  # under Stop. Suppress diagnostics here and decide success by the exit code.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    $lines = & $Program @Arguments 2>$null
    $nativeExitCode = $global:LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($nativeExitCode -ne 0) { throw "$(Split-Path $Program -Leaf) failed with exit code $nativeExitCode; no credential-bearing output is printed." }
  return ($lines | ForEach-Object { $_.ToString() }) -join "`n"
}

function Remove-RunDirectory([string]$Target) {
  $resolved = [IO.Path]::GetFullPath($Target)
  $allowedRoot = [IO.Path]::GetFullPath($workRoot).TrimEnd('\') + '\'
  $leaf = Split-Path $resolved -Leaf
  if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -or
      $leaf -notmatch '^\d{8}T\d{6}Z-[a-f0-9]{32}(-restore)?$') {
    throw 'Refusing cleanup outside the explicitly created private backup-run directory.'
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

try {
  if (-not (Test-Path -LiteralPath $restic)) { throw 'Install the verified restic executable in BackupRoot\Tools first.' }
  foreach ($directory in @($privatePath, $workRoot, (Split-Path $repository -Parent))) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  # Protect plaintext working exports and DPAPI/OAuth configuration from other users.
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $icacls = Join-Path $env:WINDIR 'System32\icacls.exe'
  $null = Invoke-Checked $icacls @($privatePath, '/inheritance:r', '/grant:r', ('*' + $identity.Value + ':(OI)(CI)F'), '*S-1-5-18:(OI)(CI)F')
  $unexpectedAllow = (Get-Acl -LiteralPath $privatePath).Access | Where-Object {
    $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($identity.Value, 'S-1-5-18')
  }
  if ($unexpectedAllow) { throw 'Private backup directory has an unexpected access grant; review its permissions before exporting.' }
  $passwordPath = Join-Path $privatePath 'restic-password.dpapi'
  if (-not (Test-Path -LiteralPath $passwordPath)) {
    $randomBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    $generator.GetBytes($randomBytes)
    $generator.Dispose()
    $secret = ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
    $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordPath
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
  }
  $secure = (Get-Content -LiteralPath $passwordPath -Raw).Trim() | ConvertTo-SecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:RESTIC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
  $env:RESTIC_FROM_PASSWORD = $env:RESTIC_PASSWORD
  $env:RCLONE_CONFIG = Join-Path $privatePath 'rclone.conf'
  if (-not (Test-Path -LiteralPath (Join-Path $repository 'config'))) {
    $null = Invoke-Checked $restic @('--repo', $repository, 'init')
  }
  New-Item -ItemType Directory -Path $runPath | Out-Null
  Push-Location -LiteralPath $repoRoot
  try {
    # The explicit ref prevents accidental backup of a different linked project.
    $schemaResult = Invoke-Checked $pnpm @('exec','supabase','db','query','--linked','--project-ref',$projectRef,
      "select nspname from pg_namespace where nspname in ('auth','public','storage','beta_private','app_private','rpc_private','registration_private','supabase_migrations','extensions') order by nspname;",'-o','json')
    $firstBrace = $schemaResult.IndexOf('{')
    if ($firstBrace -lt 0) { throw 'Schema readback did not return JSON.' }
    $schemaJson = $schemaResult.Substring($firstBrace) | ConvertFrom-Json
    $schemas = ($schemaJson.rows | ForEach-Object { $_.nspname }) -join ','
    if (-not ($schemaJson.rows.nspname -contains 'auth')) { throw 'Auth schema must be included in the backup.' }
    $null = Invoke-Checked $pnpm @('exec','supabase','db','dump','--linked','--project-ref',$projectRef,'--role-only','--file',(Join-Path $runPath 'roles.sql'))
    $null = Invoke-Checked $pnpm @('exec','supabase','db','dump','--linked','--project-ref',$projectRef,'--schema',$schemas,'--file',(Join-Path $runPath 'schema.sql'))
    $null = Invoke-Checked $pnpm @('exec','supabase','db','dump','--linked','--project-ref',$projectRef,'--schema',$schemas,'--data-only','--use-copy','--file',(Join-Path $runPath 'data.sql'))
    $integrityResult = Invoke-Checked $pnpm @('exec','supabase','db','query','--linked','--project-ref',$projectRef,
      "select json_build_object('imports',(select count(*) from public.source_imports),'sourceRows',(select count(*) from public.source_rows),'migrationCount',(select count(*) from supabase_migrations.schema_migrations),'publisherRoles',(select count(*) from public.user_roles where user_id='09a3f9f4-ff8a-4c4d-92c7-ceaf19e13b8e' and role='admin'),'authUsers',(select count(*) from auth.users),'publicTables',(select count(*) from pg_tables where schemaname='public'),'rlsDisabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity)) as integrity;",'-o','json')
    $integrityJson = $integrityResult.Substring($integrityResult.IndexOf('{')) | ConvertFrom-Json
    $databaseIntegrity = $integrityJson.rows[0].integrity
  } finally { Pop-Location }
  $exports = @('roles.sql','schema.sql','data.sql') | ForEach-Object {
    $path = Join-Path $runPath $_
    if ((Get-Item -LiteralPath $path).Length -eq 0) { throw 'An export is empty.' }
    [ordered]@{ name = $_; bytes = (Get-Item -LiteralPath $path).Length; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  $manifest = [ordered]@{ version = 1; projectRef = $projectRef; capturedAt = (Get-Date).ToUniversalTime().ToString('o'); schemas = $schemas; exports = @($exports); databaseIntegrity = $databaseIntegrity; storageObjectsIncluded = $false; externalConfigurationIncluded = $false }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runPath 'backup-manifest.json') -Encoding UTF8
  $result = Invoke-Checked $restic @('--repo',$repository,'backup',$runPath,'--tag',$projectRef,'--json')
  $summary = $result -split "`n" | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.message_type -eq 'summary' } | Select-Object -Last 1
  if (-not $summary.snapshot_id) { throw 'Backup did not return a snapshot ID.' }
  $restoreVerified = $false
  if ($VerifyRestore) {
    New-Item -ItemType Directory -Path $restorePath | Out-Null
    $null = Invoke-Checked $restic @('--repo',$repository,'restore',$summary.snapshot_id,'--target',$restorePath)
    foreach ($export in $exports) {
      $matches = @(Get-ChildItem -LiteralPath $restorePath -Recurse -File -Filter $export.name)
      if ($matches.Count -ne 1 -or (Get-FileHash -LiteralPath $matches[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $export.sha256) {
        throw 'Restored export hash differs from captured export.'
      }
    }
    $restoreVerified = $true
  }
  $offsiteVerified = $false
  $offsiteRestoreVerified = $false
  $offsiteSnapshotId = $null
  if ($CopyOffsite) {
    if (-not (Test-Path -LiteralPath $env:RCLONE_CONFIG) -or -not (Test-Path -LiteralPath $rclone)) { throw 'Configure the authorized brock-backups Google Drive remote first.' }
    $remote = 'rclone:brock-backups:BrockFantasyBackups'
    # Both restic's option CSV parser and command parser process this value.
    # A process-only PATH entry handles the user-selected directory with spaces.
    $env:PATH = (Split-Path $rclone -Parent) + ';' + $oldPath
    $rcloneOption = 'rclone.program=rclone'
    # First-time remote initialization is an explicit one-time runbook step.
    $null = Invoke-Checked $restic @('--repo',$remote,'-o',$rcloneOption,'copy','--from-repo',$repository,$summary.snapshot_id)
    $remoteReadback = Invoke-Checked $restic @('--repo',$remote,'-o',$rcloneOption,'snapshots','--json') | ConvertFrom-Json
    $remoteSnapshot = $remoteReadback | Where-Object { $_.original -eq $summary.snapshot_id -or $_.id -eq $summary.snapshot_id } | Select-Object -First 1
    if (-not $remoteSnapshot) { throw 'Off-site snapshot readback failed.' }
    $offsiteSnapshotId = $remoteSnapshot.id
    $offsiteVerified = $true
    if ($VerifyRestore) {
      $offsiteRestorePath = Join-Path $restorePath 'offsite-fresh'
      New-Item -ItemType Directory -Path $offsiteRestorePath | Out-Null
      $null = Invoke-Checked $restic @('--repo',$remote,'-o',$rcloneOption,'--no-cache','restore',$offsiteSnapshotId,'--target',$offsiteRestorePath)
      foreach ($export in $exports) {
        $matches = @(Get-ChildItem -LiteralPath $offsiteRestorePath -Recurse -File -Filter $export.name)
        if ($matches.Count -ne 1 -or (Get-FileHash -LiteralPath $matches[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $export.sha256) {
          throw 'Off-site restored export hash differs from captured export.'
        }
      }
      $offsiteRestoreVerified = $true
    }
  }
  # 30-day maximum is stricter than the draft 90-day backup maximum. Storage
  # cleanup and actual off-site retention still need verified scheduled runs.
  $null = Invoke-Checked $restic @('--repo',$repository,'forget','--tag',$projectRef,'--group-by=','--keep-within','30d','--prune')
  $recoveryConfirmed = $false
  $recoveryConfirmationPath = Join-Path $privatePath 'recovery-password-storage.json'
  if (Test-Path -LiteralPath $recoveryConfirmationPath) {
    $recoveryConfirmation = Get-Content -LiteralPath $recoveryConfirmationPath -Raw | ConvertFrom-Json
    $recoveryConfirmed = $recoveryConfirmation.operatorConfirmedSaved -eq $true
  }
  $receipt = [ordered]@{ capturedAt = $manifest.capturedAt; completedAt = (Get-Date).ToUniversalTime().ToString('o'); projectRef = $projectRef; snapshotId = $summary.snapshot_id; encrypted = $true; localRepository = $repository; offsiteVerified = $offsiteVerified; offsiteSnapshotId = $offsiteSnapshotId; restoredExportHashesVerified = $restoreVerified; offsiteRestoredExportHashesVerified = $offsiteRestoreVerified; databaseRestoreVerified = $false; recoveryKeyStoredSeparately = $recoveryConfirmed; independentRecoveryKeyTested = $false; databaseIntegrity = $databaseIntegrity; exports = @($exports) }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $privatePath 'last-backup-receipt.json') -Encoding UTF8
  $receipt | ConvertTo-Json -Depth 8
} finally {
  $env:RESTIC_PASSWORD = $oldPassword
  $env:RESTIC_FROM_PASSWORD = $oldFromPassword
  $env:RCLONE_CONFIG = $oldRcloneConfig
  $env:PATH = $oldPath
  Remove-RunDirectory $runPath
  Remove-RunDirectory $restorePath
}
