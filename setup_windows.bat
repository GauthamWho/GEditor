@echo off
rem GEditor one-click setup for Windows. Double-click this file.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 setup.py %* & goto done)
where python >nul 2>nul && (python setup.py %* & goto done)
echo.
echo Python 3.9 or newer is not installed. Opening the download page.
echo Install it (tick "Add python.exe to PATH"), then double-click this file again.
start https://www.python.org/downloads/
:done
echo.
pause
