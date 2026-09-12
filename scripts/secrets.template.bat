@echo off
REM ---------------------------------------------------------------------------
REM SlopScupper secrets. Copy to scripts\secrets.bat (gitignored), fill in the
REM values, run it from the project root:   scripts\secrets.bat
REM Each secret is pushed to BOTH environments (test.slopscore.org and
REM slopscore.org). Leave a value empty to skip that secret.
REM ---------------------------------------------------------------------------
setlocal EnableDelayedExpansion
cd /d "%~dp0\.."

REM Fine-grained GitHub PAT: Settings > Developer settings > Personal access tokens
REM > Fine-grained. Public repos, read-only (no extra permissions). Needed for the
REM sweep (code search) and 5,000 API calls/hour.
set GITHUB_CRAWL_TOKEN=

REM GitHub OAuth app: Settings > Developer settings > OAuth Apps > New.
REM Homepage https://slopscore.org, callback https://slopscore.org/auth/callback
REM (make a second app with https://test.slopscore.org/auth/callback for test,
REM or just use one app and accept that login only works on production).
set GITHUB_CLIENT_ID=
set GITHUB_CLIENT_SECRET=
REM Optional: separate OAuth app for the test site.
set TEST_GITHUB_CLIENT_ID=
set TEST_GITHUB_CLIENT_SECRET=

REM Google Safe Browsing API key (free): console.cloud.google.com > APIs >
REM enable "Safe Browsing API" > Credentials > API key. Optional.
set SAFE_BROWSING_KEY=

REM OpenRouter key (paid scans go here instead of Workers AI). Optional until
REM payments land. openrouter.ai > Keys.
set OPENROUTER_API_KEY=

REM Session signing secret. Leave empty and one is generated per environment.
set SESSION_SECRET=

REM ---------------------------------------------------------------------------
echo.
echo Pushing secrets with wrangler (you may be asked to log in once).
echo.

call :put GITHUB_CRAWL_TOKEN "%GITHUB_CRAWL_TOKEN%" production
call :put GITHUB_CRAWL_TOKEN "%GITHUB_CRAWL_TOKEN%" test

call :put GITHUB_CLIENT_ID "%GITHUB_CLIENT_ID%" production
call :put GITHUB_CLIENT_SECRET "%GITHUB_CLIENT_SECRET%" production
if not "%TEST_GITHUB_CLIENT_ID%"=="" (
  call :put GITHUB_CLIENT_ID "%TEST_GITHUB_CLIENT_ID%" test
  call :put GITHUB_CLIENT_SECRET "%TEST_GITHUB_CLIENT_SECRET%" test
)

call :put SAFE_BROWSING_KEY "%SAFE_BROWSING_KEY%" production
call :put SAFE_BROWSING_KEY "%SAFE_BROWSING_KEY%" test

call :put OPENROUTER_API_KEY "%OPENROUTER_API_KEY%" production
call :put OPENROUTER_API_KEY "%OPENROUTER_API_KEY%" test

if "%SESSION_SECRET%"=="" (
  for /f %%s in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"') do set GEN=%%s
  call :put SESSION_SECRET "!GEN!" production
  REM test already has one from the first deploy; uncomment to rotate it:
  REM call :put SESSION_SECRET "!GEN!" test
) else (
  call :put SESSION_SECRET "%SESSION_SECRET%" production
  call :put SESSION_SECRET "%SESSION_SECRET%" test
)

echo.
echo Done. Now deploy:
echo   npx wrangler d1 migrations apply slopscore --remote --env production
echo   npx wrangler deploy --env production
echo   npx wrangler deploy --env test
echo.
endlocal
exit /b 0

:put
REM %1 = name, %2 = "value", %3 = env. Skips empty values. No trailing newline is sent.
set "VAL=%~2"
if "%VAL%"=="" (
  echo   skip  %1 ^(%3^): empty
  exit /b 0
)
echo   put   %1 ^(%3^)
<nul set /p ="%VAL%" | npx wrangler secret put %1 --env %3
exit /b 0
