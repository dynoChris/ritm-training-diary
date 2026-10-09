@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 server.py --open
goto finished
:use_python
where python >nul 2>nul
if errorlevel 1 goto no_python
python server.py --open
goto finished
:no_python
echo Python 3.10 or newer is required.
echo Install Python and run this file again.
:finished
pause
