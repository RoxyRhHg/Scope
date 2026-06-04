@echo off
chcp 65001 >nul 2>&1
echo.
echo ============================================
echo   涨停预测系统 - 每日运行
echo   %date% %time%
echo ============================================
echo.

cd /d "%~dp0\.."

:: 检查服务是否运行
curl -s http://127.0.0.1:4173/api/health >nul 2>&1
if %errorlevel% neq 0 (
    echo [启动] Scope 服务未运行，正在启动...
    start /b node src\server.js
    timeout /t 5 /nobreak >nul
)

:: 运行预测
echo [运行] 正在拉取快照并预测...
python scripts\daily_predict.py --save

echo.
echo [完成] 报告已保存到 .cache\daily-predict-%date:~0,4%-%date:~5,2%-%date:~8,2%.json
echo.
pause
