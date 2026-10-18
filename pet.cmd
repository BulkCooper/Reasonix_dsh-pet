@echo off
setlocal
set "NODE_EXE=node"
if exist "%~dp0state\node-path.txt" set /p NODE_EXE=<"%~dp0state\node-path.txt"
"%NODE_EXE%" "%~dp0scripts\pet.mjs" %*
exit /b %errorlevel%
