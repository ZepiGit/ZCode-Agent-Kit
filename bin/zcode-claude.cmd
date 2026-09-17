@echo off
rem ZCode kit: run Claude Code through the local zcode-proxy (opt-in wrapper).
rem Preflight, argument passing and the --settings injection happen in
rem cli/launch.mjs (no cmd.exe argument re-parsing; paths with ) or % are safe).
setlocal
set "ROOT=%~dp0.."
node "%ROOT%\cli\launch.mjs" claude-code %*
exit /b %errorlevel%
