@echo off
REM Inspect the generated site and report problems.
REM
REM Checks the same things the build does, without rebuilding: broken local
REM links, images with no alt text, missing *_min counterparts, oversized
REM assets, missing or malformed YAML front matter, duplicate slugs, missing
REM meta descriptions, and any reference that reaches outside this domain.
REM
REM Also rewrites _site\status_check.html with the same findings.
REM Exits non-zero if there are errors, so it can gate a deploy.
setlocal
cd /d "%~dp0"

if not exist _site (
  echo _site does not exist - run site_generate.exe first.
  exit /b 1
)

if exist site_generate.exe (
  site_generate.exe --check-only %*
  exit /b %errorlevel%
)

where bun >nul 2>nul
if %errorlevel%==0 if exist node_modules (
  echo site_generate.exe not found - using bun.
  bun run eleventy_binary/build.mjs --check-only %*
  exit /b %errorlevel%
)

echo Neither site_generate.exe nor a bun + node_modules setup was found.
echo Compile the binary with eleventy_binary\compile.sh
exit /b 1
