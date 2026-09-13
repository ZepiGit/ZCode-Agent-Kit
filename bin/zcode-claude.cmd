@echo off
rem ZCode kit: run Claude Code through the local zcode-proxy (opt-in wrapper).
rem Your normal `claude` stays untouched — this wrapper injects the generated
rem settings file (CLI --settings outranks user settings.json).
setlocal
set "ROOT=%~dp0.."
node "%ROOT%\proxy\zcode-proxy-manager.mjs" start >nul 2>&1
set "SETTINGS=%ROOT%\generated\claude-zcode-settings.json"
if not exist "%SETTINGS%" (
  echo [zcode-kit] missing %SETTINGS% — run: node "%ROOT%\setup.mjs" 1>&2
  exit /b 1
)
claude --settings "%SETTINGS%" %*
