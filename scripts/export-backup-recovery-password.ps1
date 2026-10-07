[CmdletBinding()]
param([string]$BackupRoot = 'D:\Brock Fantasy')

$ErrorActionPreference = 'Stop'
# The visible Windows PowerShell process may inherit a PowerShell 7 module path.
# Load the modules belonging to the running shell rather than that inherited path.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$privatePath = Join-Path ([IO.Path]::GetFullPath($BackupRoot)) 'Private'
$secure = (Get-Content -LiteralPath (Join-Path $privatePath 'restic-password.dpapi') -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  # User-operated transfer only: nothing is printed or written in plaintext.
  Set-Clipboard -Value ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
  Write-Host 'The backup recovery password is on the clipboard. Paste it into your password manager now.'
  Write-Host 'Label it Brock Fantasy restic recovery. Keep the password manager recoverable without this computer.'
  Write-Host 'Do not paste the password in chat. Clear Windows clipboard history after saving it.'
  $confirmation = Read-Host 'Type SAVED only after the entry is saved; otherwise press Enter'
  if ($confirmation -ceq 'SAVED') {
    [ordered]@{ recordedAt = (Get-Date).ToUniversalTime().ToString('o');
      destination = 'operator-selected existing password manager';
      operatorConfirmedSaved = $true; independentRecoveryTested = $false } |
      ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privatePath 'recovery-password-storage.json') -Encoding UTF8
    Write-Host 'Storage confirmation recorded. Independent password-manager/database recovery still needs a test.'
  } else { Write-Host 'No storage confirmation recorded.' }
} finally {
  # Windows PowerShell 5.1 rejects an empty clipboard string. Replace it with
  # harmless whitespace and guarantee BSTR cleanup even if clipboard access fails.
  try { Set-Clipboard -Value ' ' }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
