@echo off
rem Double-click me: stops Kitchen Hub and removes it from startup (your data is kept).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pc\hub\setup.ps1" -Remove
echo.
pause
