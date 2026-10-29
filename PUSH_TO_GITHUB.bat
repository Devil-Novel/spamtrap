@echo off
echo ==============================
echo  Spam Trap - GitHub Push Tool
echo ==============================
echo.
cd /d "%~dp0"
if not exist package.json (
    echo ERROR: package.json not found.
    pause
    exit /b 1
)
if not exist index.js (
    echo ERROR: index.js not found.
    pause
    exit /b 1
)
echo Files OK. Pushing to GitHub...
echo.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 git init
if errorlevel 1 goto :failed
git remote get-url origin >nul 2>&1
if errorlevel 1 git remote add origin https://github.com/Devil-Novel/spamtrap.git
if errorlevel 1 goto :failed
git add .gitignore .dockerignore .env.example package.json package-lock.json index.js commands.js deploy-commands.js lib web tests Dockerfile railway.json Procfile README.md PROTECTION_GUIDE.md UPGRADE.md CHANGELOG.md
if errorlevel 1 goto :failed
git diff --cached --quiet
if errorlevel 1 git commit -m "Spam Trap 4.0.1: security, recovery and dashboard fixes"
if errorlevel 1 goto :failed
git push -u origin HEAD
if errorlevel 1 goto :failed
echo.
echo ==============================
echo  DONE! Refresh your GitHub repo page.
echo ==============================
pause
exit /b 0
:failed
echo Push stopped. Resolve the Git error above. No history was force-pushed.
pause
exit /b 1
