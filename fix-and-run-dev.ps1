# Fix PowerShell execution policy for current user and run dev server
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
Write-Host "Execution policy updated. Running dev server..." -ForegroundColor Green
pnpm run dev

