@echo off
setlocal
title RandomFavorites - Vencord Manager

set "MANAGER_SCRIPT=%~dp0scripts\RandomFavoritesManager.ps1"

if not exist "%MANAGER_SCRIPT%" (
    echo [ERROR] Missing file:
    echo %MANAGER_SCRIPT%
    echo.
    echo Download and extract the complete RandomFavorites repository before running this file.
    set "EXIT_CODE=1"
    goto :finish
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%MANAGER_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if "%EXIT_CODE%"=="0" (
    echo RandomFavorites Manager finished successfully.
) else (
    echo RandomFavorites Manager failed with exit code %EXIT_CODE%.
)

if not defined RANDOM_FAVORITES_NO_PAUSE pause
exit /b %EXIT_CODE%
