[CmdletBinding()]
param(
  [string]$BackupRoot = 'D:\Brock Fantasy',
  [switch]$ProductionConsentConfirmed
)

$ErrorActionPreference = 'Stop'
if (-not $ProductionConsentConfirmed) {
  throw 'Confirm In production and complete fresh offline consent before exporting the runner credential.'
}
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$configPath = Join-Path ([IO.Path]::GetFullPath($BackupRoot)) 'Private\rclone.conf'
$configText = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
$headers = [regex]::Matches($configText, '(?m)^[ \t]*\[([^\]\r\n]+)\][ \t]*\r?$')
$selected = @($headers | Where-Object { $_.Groups[1].Value -ceq 'brock-backups' })
if ($selected.Count -ne 1) { throw 'Exactly one brock-backups section is required; review the config privately.' }
$header = $selected[0]
$next = $headers | Where-Object { $_.Index -gt $header.Index } | Select-Object -First 1
$end = if ($next) { $next.Index } else { $configText.Length }
$section = $configText.Substring($header.Index, $end - $header.Index).Trim() + "`n"
if ($section -notmatch '(?m)^scope[ \t]*=[ \t]*drive\.file[ \t]*\r?$' -or
    $section -notmatch '(?m)^token[ \t]*=[ \t]*\{') {
  throw 'A completed narrow-scope backup connection is required.'
}
try {
  Set-Clipboard -Value ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($section)))
  Write-Host 'Only the brock-backups section is on the clipboard as Base64. Base64 is not encryption.'
  Write-Host 'Paste into GitHub Settings > Secrets and variables > Actions > New repository secret.'
  Write-Host 'Name: BROCK_BACKUP_RCLONE_CONFIG_BASE64. Do not paste into chat or a repository file.'
  $confirmation = Read-Host 'Type STORED after adding the GitHub secret; otherwise press Enter'
  if ($confirmation -ceq 'STORED') { Write-Host 'Operator reports secret stored; runner validation is still required.' }
} finally {
  Set-Clipboard -Value ' '
  $configText = $null
  $section = $null
}
