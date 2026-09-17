@echo off
rem Aider x ZCode launcher: process-local env only (no setx). The key is read
rem by cli/launch.mjs and never parsed by cmd.exe.
setlocal
set "ROOT=%~dp0.."
node "%ROOT%\cli\launch.mjs" aider %*
exit /b %errorlevel%
