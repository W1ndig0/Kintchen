@echo off
rem Double-click me: sets up Kitchen Hub on this PC (no administrator needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pc\hub\setup.ps1"
echo.
pause
