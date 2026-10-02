@echo off
cd /d "%~dp0"
git config submodule.recurse false
git add index.html liveActivity.js *.js *.css *.json
git commit -m "Update refresh handlers and real-time features"
git push origin main
echo.
echo ========================================
echo Done! Press any key to exit.
echo ========================================
pause