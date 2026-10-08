@echo off
chcp 65001 >nul
title RKM SPI 2T - EDP PANEL
color 0A
cls

echo.
echo  ================================================================
echo.
echo       ██████╗ ██╗  ██╗███╗   ███╗    ███████╗██████╗ ██╗
echo       ██╔══██╗██║ ██╔╝████╗ ████║    ██╔════╝██╔══██╗██║
echo       ██████╔╝█████╔╝ ██╔████╔██║    ███████╗██████╔╝██║
echo       ██╔══██╗██╔═██╗ ██║╚██╔╝██║    ╚════██║██╔═══╝ ██║
echo       ██║  ██║██║  ██╗██║ ╚═╝ ██║    ███████║██║     ██║
echo       ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝    ╚══════╝╚═╝     ╚═╝
echo.
echo                   (C)  EDP SPI BDG 9 2T
echo.
echo  ================================================================
echo.
echo       [ SYSTEM ]  RKM SPI Application
echo       [ MODULE ]  EDP SPI 2T
echo       [ MODE   ]  PRODUCTION
echo.
echo  ----------------------------------------------------------------
echo.

echo  [*] Checking for updates...
call git pull

echo.
echo  [OK] Git repository updated.
echo.

echo  [*] Installing dependencies...
call npm install

echo.
echo  [OK] Dependencies ready.
echo.

echo  [*] Building project...
call npm run build

echo.
echo  [OK] Build completed.
echo.

echo  ================================================================
echo.
echo       [ SYSTEM ] Starting RKM SPI 2T...
echo       [ STATUS ] ONLINE
echo.
echo  ================================================================
echo.

call npm start

echo.
echo  ================================================================
echo       APPLICATION STOPPED
echo  ================================================================
pause