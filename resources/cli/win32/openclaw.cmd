@echo off
setlocal

if /i "%1"=="update" (
    echo openclaw is managed by __BRAND_NAME__ ^(bundled version^).
    echo.
    echo To update openclaw, update __BRAND_NAME__:
    echo   Open __BRAND_NAME__ ^> Settings ^> Check for Updates
    exit /b 0
)

rem Switch console to UTF-8 so Unicode box-drawing and CJK text render correctly
rem on non-English Windows (e.g. Chinese CP936). Save the previous codepage to restore later.
for /f "tokens=2 delims=:." %%a in ('chcp') do set /a "_CP=%%a" 2>nul
chcp 65001 >nul 2>&1

set OPENCLAW_EMBEDDED_IN=__BRAND_NAME__
rem Pin the bundled CLI to this brand's config/state dir (~\__BRAND_DATA_DIR__),
rem matching the desktop app. Honor an explicit override if the user set one.
if not defined OPENCLAW_STATE_DIR set "OPENCLAW_STATE_DIR=%USERPROFILE%\__BRAND_DATA_DIR__"
set "NODE_EXE=%~dp0..\bin\node.exe"
set "OPENCLAW_ENTRY=%~dp0..\openclaw\openclaw.mjs"

set "_USE_BUNDLED_NODE=0"
if exist "%NODE_EXE%" (
    "%NODE_EXE%" -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit((maj>22||maj===22&&min>=16)?0:1)" >nul 2>&1
    if not errorlevel 1 set "_USE_BUNDLED_NODE=1"
)

if "%_USE_BUNDLED_NODE%"=="1" (
    "%NODE_EXE%" "%OPENCLAW_ENTRY%" %*
) else (
    set ELECTRON_RUN_AS_NODE=1
    "%~dp0..\..\__BRAND_EXE__.exe" "%OPENCLAW_ENTRY%" %*
)
set _EXIT=%ERRORLEVEL%

if defined _CP chcp %_CP% >nul 2>&1

endlocal & exit /b %_EXIT%
