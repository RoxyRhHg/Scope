@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================
echo   Scope - A股价值投资筛选系统
echo   %date% %time%
echo ============================================
echo.

:: 先杀掉已有的 node 进程
taskkill /F /IM node.exe >nul 2>&1

echo [1/2] 启动 Scope 服务...
start "Scope Server" /min node src/server.js
timeout /t 3 /nobreak >nul

echo [2/2] 打开浏览器...
start http://127.0.0.1:4173

echo.
echo 服务已启动，浏览器已打开。
echo 关闭 "Scope Server" 窗口将停止服务。
echo.
pause
