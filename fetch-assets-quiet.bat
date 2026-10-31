@echo off
rem Stronghold Protocol - download / repair art and audio with a quiet console (Windows).
rem Same as `node tools\fetch-assets.mjs`, plus:
rem   * quiet-log.mjs hides the download-error summary lines (SP_QUIET=0 disables the filter)
rem   * SP_ASSET_SOURCE=mirror when the network cannot reach raw.githubusercontent.com (SP_ASSET_SOURCE=direct keeps it off)
rem Extra arguments go to tools\fetch-assets.mjs, e.g.:  fetch-assets-quiet.bat --concurrency=8 --force
rem A plain re-run only retries what is missing or failed; nothing already on disk is downloaded again.
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 if exist "%~dp0..\node\node.exe" set "PATH=%~dp0..\node;%PATH%"

if not defined SP_ASSET_SOURCE set "SP_ASSET_SOURCE=mirror"

rem one set per line: a %VAR% inside an if (...) block is expanded before the block runs
if /i "%SP_QUIET%"=="0" goto :run
set "HOOK=%~dp0quiet-log.mjs"
set "HOOK=%HOOK:\=/%"
set "NODE_OPTIONS=%NODE_OPTIONS% --import file:///%HOOK%"
:run

node "%~dp0tools\fetch-assets.mjs" %*
exit /b %errorlevel%