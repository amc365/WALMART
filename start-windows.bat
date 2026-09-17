@echo off
REM Double-click this file on Windows to start monitoring.
cd /d "%~dp0"
set LOG=%~dp0setup-log.txt

echo Walmart Seller Center monitor > "%LOG%"
echo Walmart Seller Center monitor
echo -----------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. >> "%LOG%"
  echo.
  echo Node.js is not installed on this PC.
  echo Install it from https://nodejs.org ^(pick the LTS button^), then
  echo double-click this file again.
  echo.
  echo This window stays open. Close it yourself when you are done reading.
  pause >nul
  exit /b 1
)

echo Setting up ^(first time takes a few minutes^)...
echo --- npm install --- >> "%LOG%"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 goto :failed

REM Playwright's own browser is a large download that slow or filtered
REM connections often kill. Not fatal: an installed Chrome or Edge is used.
echo Downloading a browser ^(optional - Chrome or Edge is used if this fails^)...
echo --- playwright install --- >> "%LOG%"
call npx --yes playwright install chromium >> "%LOG%" 2>&1
if errorlevel 1 echo    Download did not finish - your Chrome will be used instead. That is fine.

echo.
echo Starting. A browser window will open and click through your
echo Seller Center pages by itself - that is meant to happen. Do not
echo type in it or close it. Your own mouse and browser are unaffected.
echo.
echo Sign in when it shows the Walmart login. That happens once.
echo Leave this black window open. Press Ctrl-C to stop.
echo.

REM --headed shows the browser doing the work. Delete it to hide the window.
REM --realCursor moves your actual Windows mouse pointer. Delete that word if
REM you would rather keep your mouse free while it runs.
node monitor/run.js --hours=8 --headed --realCursor

echo.
echo ---------------------------------------------------------------
echo Finished. A record of the setup is in this file:
echo    %LOG%
echo Live results are in: monitor\logs\status.log
echo.
echo This window stays open. Close it yourself when you are done reading.
pause >nul
exit /b 0

:failed
echo.
echo ---------------------------------------------------------------
echo SETUP FAILED. The reason is at the bottom of this file:
echo    %LOG%
echo.
echo Open that file, copy the last few lines, and send them over.
echo.
echo This window stays open. Close it yourself when you are done reading.
pause >nul
exit /b 1
