@echo off
REM Double-click this file on Windows to start monitoring.
cd /d "%~dp0"

echo Walmart Seller Center monitor
echo -----------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this PC.
  echo Install it from https://nodejs.org ^(pick the LTS button^), then
  echo double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Setting up ^(first time takes a few minutes^)...
call npm install --silent || goto :failed
call npx --yes playwright install chromium || goto :failed

echo.
echo Starting. If a browser window opens, sign in to Seller Center -
echo that happens once, then it remembers you.
echo Leave this window open. Press Ctrl-C to stop.
echo.

node monitor/run.js --hours=8

echo.
pause
exit /b 0

:failed
echo Setup failed.
pause
exit /b 1
