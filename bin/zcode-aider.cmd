@echo off
rem Aider x ZCode launcher: process-local env only (no setx).
rem Credentials are NOT written here - this reads the kit-generated env file.
setlocal
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI"
node "%ROOT%\cli\heal.mjs"
if errorlevel 1 exit /b %errorlevel%
if not exist "%ROOT%\generated\aider-zcode.env" (
  echo zcode-aider: missing generated\aider-zcode.env - run: node cli/zcode-kit.mjs integrate aider 1>&2
  exit /b 2
)
for /f "usebackq eol=# tokens=1,* delims=" %%A in ("%ROOT%\generated\aider-zcode.env") do set "%%A"
if "%~1"=="" (
  aider --model "%ZCODE_AIDER_DEFAULT_MODEL%"
) else (
  aider %*
)
