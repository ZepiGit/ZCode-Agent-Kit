@echo off
rem ZCode kit: run Codex CLI in an isolated CODEX_HOME routed through the local
rem zcode-proxy (opt-in wrapper). Your normal `codex` and ~/.codex are untouched.
rem Preflight, key handling and argument passing happen in cli/launch.mjs.
setlocal
set "ROOT=%~dp0.."
node "%ROOT%\cli\launch.mjs" codex %*
exit /b %errorlevel%
