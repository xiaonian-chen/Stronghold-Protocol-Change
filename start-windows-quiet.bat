@echo off
rem Stronghold Protocol - double-click to start with a quiet console (Windows). Docs: docs\DEPLOY.md
rem Wraps scripts\start-windows.bat (setup, art download, server, browser) and adds two things only:
rem   * quiet-log.mjs hides [DIAG: / [mod: / download-error lines (SP_QUIET=0 disables the filter)
rem   * SP_ASSET_SOURCE=mirror when the network cannot reach raw.githubusercontent.com (SP_ASSET_SOURCE=direct keeps it off)
rem Extra arguments go to scripts\launch.mjs, e.g.:  start-windows-quiet.bat --port 3001 --no-open
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 if exist "%~dp0..\node\node.exe" set "PATH=%~dp0..\node;%PATH%"

if not defined SP_ASSET_SOURCE set "SP_ASSET_SOURCE=mirror"

rem one set per line: a %VAR% inside an if (...) block is expanded before the block runs
if /i "%SP_QUIET%"=="0" goto :run
set "HOOK=%~dp0quiet-log.mjs"
set "HOOK=%HOOK:\=/%"
set "NODE_OPTIONS=%NODE_OPTIONS% --import file:///%HOOK%"
:run

call "%~dp0scripts\start-windows.bat" %*
exit /b %errorlevel%