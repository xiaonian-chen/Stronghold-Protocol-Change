@echo off
chcp 65001 >nul
title 卫戍协议：盟约
echo.
echo   ============================================
echo    卫戍协议：盟约 - 一键启动 v0.3.1
echo   ============================================
echo.
echo   关闭本窗口即可停止服务器
echo.
echo   --------------------------------------------
echo   [0] 测试模式
echo   [1] 正常游玩
echo   --------------------------------------------
echo.
set /p MODE="请输入编号（直接回车默认 1）: "
if "%MODE%"=="" set "MODE=1"

set "TEST_ARG="
if "%MODE%"=="0" set "TEST_ARG=--test-mode force"

echo.
set /p PORT="请输入端口号（直接回车默认 3000）: "
if "%PORT%"=="" set "PORT=3000"

rem 指向 Stronghold-Protocol 子目录
set "APP=%~dp0Stronghold-Protocol\"

rem 优先使用项目自带的 Node.js（无需系统安装）
set "PATH=%~dp0node;%PATH%"

rem ============================================================
rem  Mod 管理器 — 弹出浏览器页面选择要启用的 Mod
rem ============================================================
echo.
echo   正在打开 Mod 管理器...
node "%~dp0mod-framework\config-ui.js"
if errorlevel 1 (
  echo.
  echo   Mod 管理器已取消，服务器未启动。
  pause
  exit /b 0
)

rem ============================================================
rem  根据 Mod 管理器配置决定启动 20p 还是原版上游
rem ============================================================
echo.
node "%~dp0mod-framework\check-mods.js" 2>nul
if %errorlevel% equ 0 (
  echo   已启用 Mod 支持
  goto :startMod
) else (
  echo   未启用任何 Mod，使用原版上游
  goto :startVanilla
)

rem ============================================================
rem  Mod 模式 — 通过 mod-framework/modServer.js 启动
rem  --import 注册模块解析钩子，使服务端 override 文件生效
rem  modServer.js 同时处理：mod 钩子注册 + 客户端文件服务
rem ============================================================
:startMod
set "SP_20P=1"
set "SP_PLUGIN_SCRIPTS=trusted-force"
set "PORT=%PORT%"
if "%MODE%"=="0" set "SP_TEST_MODE=force"
cd /d "%~dp0"

rem 运行上游 setup（依赖安装、资源下载等）
echo   正在准备运行环境...
node "%~dp0Stronghold-Protocol\tools\setup.mjs" --quiet
if errorlevel 1 (
  echo.
  echo   环境准备失败，请检查上方错误信息。
  pause
  exit /b 1
)

node --import "./Stronghold-Protocol/scripts/20p-loader.mjs" "./mod-framework/modServer.js"
goto :end

rem ============================================================
rem  原版上游模式 — 走上游 launcher
rem ============================================================
:startVanilla
call "%APP%scripts\start-windows.bat" --scripts trusted-force --port %PORT% %TEST_ARG% %*

:end
pause