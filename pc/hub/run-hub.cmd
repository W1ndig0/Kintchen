@echo off
rem Kitchen Hub: keeps the hub running (starts it again if it stops, e.g. after installing a new kit).
rem Started hidden at sign-in by the shortcut that "Install Kitchen Hub.cmd" puts in your Startup folder.
cd /d "%~dp0"
:loop
node "%~dp0hub.js"
timeout /t 5 /nobreak >nul
goto loop
