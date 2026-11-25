@echo off
rem Start GEditor: opens the editor in your browser. Other devices on your Wi-Fi use the link shown in the Share button.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo GEditor is not set up yet. Double-click setup_windows.bat first.
  pause & exit /b 1
)
echo GEditor is running. Close this window to stop it.
".venv\Scripts\python.exe" -u server.py --last
pause
