@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Actualizando seguimiento de flota y pagos NACIONAL...
python -I actualizar_seguimiento.py %*
if errorlevel 1 (echo. & echo HUBO UN ERROR, revisa el mensaje de arriba. & pause) else (start "" "%~dp0DASHBOARD.html")
