@echo off
chcp 65001 >nul
echo ============================================
echo   Sync Jump Online - 哥俩·同步跃迁
echo ============================================
echo.
echo 正在安装依赖...
cd /d "%~dp0server"
pip install -r requirements.txt
echo.
echo 启动服务器... 访问 http://localhost:8000
echo.
python main.py
pause
