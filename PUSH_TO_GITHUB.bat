@echo off
echo ==============================
echo  Spam Trap - GitHub Push Tool
echo ==============================
echo.

cd /d "%~dp0"

if not exist package.json (
    echo ERROR: package.json not found next to this script.
    echo Make sure you extracted ALL files into this folder.
    pause
    exit /b 1
)
if not exist src\index.js (
    echo ERROR: src\index.js not found.
    echo Make sure the src folder was extracted too.
    pause
    exit /b 1
)

echo Files OK. Pushing to GitHub...
echo.
git init
git add .
git commit -m "Spam Trap bot"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/aimanmoustafa/spamtrap.git
git push -u origin main --force

echo.
echo ==============================
echo  DONE! Refresh your GitHub repo page.
echo  You should see package.json and src/ at the ROOT.
echo ==============================
pause
