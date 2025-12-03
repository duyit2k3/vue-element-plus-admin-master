# Fix PowerShell execution policy for current user (no admin required)
# This allows pnpm and other npm scripts to run in PowerShell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
Write-Host "✓ Execution policy updated successfully!" -ForegroundColor Green
Write-Host "You can now run 'pnpm run dev' normally." -ForegroundColor Green

