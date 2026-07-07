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
git init
git add .
git commit -m "Spam Trap bot v2"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/aimanmoustafa/spamtrap.git
git push -u origin main --force
echo.
echo ==============================
echo  DONE! Refresh your GitHub repo page.
echo ==============================
pause
