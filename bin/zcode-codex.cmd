@echo off
rem ZCode kit: run Codex CLI in an isolated CODEX_HOME routed through the local
rem zcode-proxy (opt-in wrapper). Your normal `codex` and ~/.codex are untouched.
setlocal
set "ROOT=%~dp0.."
node "%ROOT%\proxy\zcode-proxy-manager.mjs" start >nul 2>&1
if not exist "%ROOT%\.proxykey" (
  echo [zcode-kit] missing %ROOT%\.proxykey — run: node "%ROOT%\setup.mjs" 1>&2
  exit /b 1
)
if not exist "%ROOT%\generated\codex-home\config.toml" (
  echo [zcode-kit] missing generated\codex-home — run: node "%ROOT%\setup.mjs" 1>&2
  exit /b 1
)
for /f "usebackq delims=" %%i in ("%ROOT%\.proxykey") do set "ZCODE_PROXY_KEY=%%i"
set "CODEX_HOME=%ROOT%\generated\codex-home"
codex %*
