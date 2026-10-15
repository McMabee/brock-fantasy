[CmdletBinding()]
param(
  [string]$BackupRoot = 'D:\Brock Fantasy',
  [ValidateSet('Local', 'Offsite')][string]$Source = 'Local',
  [switch]$UsePasswordManager
)
$ErrorActionPreference = 'Stop'
# Use this shell's modules if a Windows PowerShell window inherits a PowerShell 7 module path.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$oldPassword = $env:RESTIC_PASSWORD
$oldRcloneConfig = $env:RCLONE_CONFIG
$oldPath = $env:PATH
$pointer = [IntPtr]::Zero
try {
  $private = Join-Path ([IO.Path]::GetFullPath($BackupRoot)) 'Private'
  $passwordSource = 'workstation-dpapi'
  if ($UsePasswordManager) {
    Write-Host 'Retrieve the recovery password from your password manager. Input is hidden; do not paste it in chat.'
    $secure = Read-Host 'Backup recovery password' -AsSecureString
    if ($secure.Length -eq 0) { throw 'No recovery password supplied.' }
    $passwordSource = 'operator-password-manager'
  } else {
    $secure = (Get-Content -LiteralPath (Join-Path $private 'restic-password.dpapi') -Raw).Trim() | ConvertTo-SecureString
  }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:RESTIC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:RCLONE_CONFIG = Join-Path $private 'rclone.conf'
  $env:PATH = (Join-Path ([IO.Path]::GetFullPath($BackupRoot)) 'Tools') + ';' + $oldPath
  & node (Join-Path $PSScriptRoot 'verify-brock-backup-restore.mjs') $BackupRoot $Source $passwordSource
  if ($LASTEXITCODE -ne 0) { throw 'Disposable database restore did not pass; see its sanitized evidence.' }
} finally {
  $env:RESTIC_PASSWORD = $oldPassword
  $env:RCLONE_CONFIG = $oldRcloneConfig
  $env:PATH = $oldPath
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($null -ne $secure) { $secure.Dispose() }
}
