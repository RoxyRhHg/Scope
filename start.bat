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

:: 预取行业数据（如果缓存不存在）
if not exist ".cache\industry-map.json" (
    echo [1/3] 首次运行，正在获取行业数据...
    python scripts\prefetch_industry.py
    echo.
)

echo [2/3] 启动 Scope 服务...
start /b node src/server.js
timeout /t 3 /nobreak >nul

echo [3/3] 打开浏览器...
start http://127.0.0.1:4173

echo.
echo 服务已启动，浏览器已打开。
echo 关闭此窗口将停止服务。
echo.
pause
