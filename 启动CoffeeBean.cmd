@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [CoffeeBean] 未找到 Node.js。
  echo 请安装 Node.js 18 或更高版本，然后重新双击本文件：
  echo https://nodejs.org/
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

if not "%~1"=="" set "COFFEEBEAN_PORT=%~1"
if not defined COFFEEBEAN_PORT set "COFFEEBEAN_PORT=4173"

echo [CoffeeBean] 正在启动 TAS 工作台……
echo [CoffeeBean] 关闭本窗口即可停止服务器。
node ".\test\server.mjs" --open

if errorlevel 1 (
  echo.
  echo [CoffeeBean] 启动失败，请查看上方错误信息。
  pause
)

