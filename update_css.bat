@echo off
REM Rebuild the stylesheet from css\input.css (which imports css\theme.css).
REM
REM   css\main.css      minified - what the site loads
REM   css\main_max.css  expanded - for troubleshooting only, never linked
REM
REM site_generate.exe does this for you on every build; this script is for
REM tweaking theme.css and watching the result without a full rebuild.
setlocal
cd /d "%~dp0"

set BIN=tailwindcss-windows-x64.exe
if not exist "%BIN%" (
  echo %BIN% not found.
  exit /b 1
)

if "%1"=="--watch" (
  echo Watching css\input.css to css\main.css ^(Ctrl-C to stop^)...
  "%BIN%" -i css/input.css -o css/main.css --minify --watch
  exit /b 0
)

"%BIN%" -i css/input.css -o css/main.css --minify
if errorlevel 1 exit /b 1
"%BIN%" -i css/input.css -o css/main_max.css
if errorlevel 1 exit /b 1

echo.
echo Wrote css\main.css (minified) and css\main_max.css (expanded).
endlocal
