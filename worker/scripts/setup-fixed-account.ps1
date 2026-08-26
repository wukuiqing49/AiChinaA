param(
  [Parameter(Mandatory = $true)]
  [string]$Username,
  [string]$DisplayName = $Username
)

$securePassword = Read-Host "Password (at least 8 characters)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($plainPassword.Length -lt 8) {
    throw "Password must contain at least 8 characters."
  }

  $env:AUTH_USERNAME = $Username
  $env:AUTH_DISPLAY_NAME = $DisplayName
  $env:AUTH_PASSWORD = $plainPassword
  $accountJson = node worker/scripts/create-fixed-account.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "Account generation failed."
  }
  $accountArray = "[$accountJson]"
  $accountArray | pnpm --filter @a-share/worker exec wrangler secret put FIXED_ACCOUNTS
  if ($LASTEXITCODE -ne 0) {
    throw "FIXED_ACCOUNTS upload failed."
  }
  Write-Host "FIXED_ACCOUNTS updated. Use the new password to log in."
}
finally {
  Remove-Item Env:AUTH_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:AUTH_DISPLAY_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:AUTH_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}
