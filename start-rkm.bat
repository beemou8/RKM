@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title RKM SPI 2T - EDP PANEL
cd /d "%~dp0"

:: ---------- Warna (Windows 10/11) : biru SPI -> hijau SPI ----------
for /f %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
for /f %%a in ('copy /Z "%~f0" nul') do set "CR=%%a"

set "RS=%ESC%[0m"
set "WH=%ESC%[97m"
set "DM=%ESC%[90m"
set "RD=%ESC%[91m"

set "BL=%ESC%[38;2;60;105;220m"
set "GN=%ESC%[38;2;141;198;63m"

set "B1=%ESC%[38;2;70;120;235m"
set "B2=%ESC%[38;2;62;110;225m"
set "B3=%ESC%[38;2;55;100;215m"
set "B4=%ESC%[38;2;48;90;205m"
set "B5=%ESC%[38;2;42;80;195m"
set "B6=%ESC%[38;2;36;70;185m"

set "G1=%ESC%[38;2;100;200;90m"
set "G2=%ESC%[38;2;110;203;80m"
set "G3=%ESC%[38;2;120;205;75m"
set "G4=%ESC%[38;2;130;208;68m"
set "G5=%ESC%[38;2;140;210;62m"
set "G6=%ESC%[38;2;150;212;56m"

:: warna spinner berputar (biru -> hijau)
set "C0=%ESC%[38;2;60;105;220m"
set "C1=%ESC%[38;2;90;150;170m"
set "C2=%ESC%[38;2;141;198;63m"
set "C3=%ESC%[38;2;90;150;170m"
set "F0=|"
set "F1=/"
set "F2=-"
set "F3=\"
set "DT1=."
set "DT2=.."
set "DT3=..."

set "LOG=rkm-log.txt"
set "FLAG=.rkm-flag"
if exist %LOG% del %LOG%
if exist %FLAG% del %FLAG%

:: ---------- Banner ----------
cls
<nul set /p "=%ESC%[?25l"
echo.
echo.
echo   %B1%██████╗ ██╗  ██╗███╗   ███╗%RS%    %G1%███████╗██████╗ ██╗%RS%
echo   %B2%██╔══██╗██║ ██╔╝████╗ ████║%RS%    %G2%██╔════╝██╔══██╗██║%RS%
echo   %B3%██████╔╝█████╔╝ ██╔████╔██║%RS%    %G3%███████╗██████╔╝██║%RS%
echo   %B4%██╔══██╗██╔═██╗ ██║╚██╔╝██║%RS%    %G4%╚════██║██╔═══╝ ██║%RS%
echo   %B5%██║  ██║██║  ██╗██║ ╚═╝ ██║%RS%    %G5%███████║██║     ██║%RS%
echo   %B6%╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝%RS%    %G6%╚══════╝╚═╝     ╚═╝%RS%
echo.
echo   %DM%EDP SPI BDG 9  ·  2T%RS%
echo.
echo   %BL%━━━━━━━━━━━━━━━━━━━━%GN%━━━━━━━━━━━━━━━━━━━━%RS%
echo.
echo.

:: ---------- Jalankan semua proses di belakang layar ----------
call :GETTIME
set "T0=!NOW!"
set "FRAME=0"
set "T=0"

start "" /b cmd /c "git pull >> %LOG% 2>&1 & npm install >> %LOG% 2>&1 && npm run build >> %LOG% 2>&1 && (>%FLAG% echo 0) || (>%FLAG% echo 1)"

:: ---------- Loading muter ----------
:WAIT
if exist %FLAG% goto DONE
set /a FRAME=(FRAME+1)%%4
set /a T+=1
set /a DOT=(T/4)%%4
set "DOTS="
if !DOT! gtr 0 set "DOTS=!DT%DOT%!"
<nul set /p "=!CR!!ESC![2K   !C%FRAME%!!F%FRAME%!!RS!   !WH!LOADING!DM!!DOTS!!RS!"
ping -n 1 -w 100 192.0.2.1 >nul 2>&1
goto WAIT

:DONE
set "RESULT=1"
set /p RESULT=<%FLAG%
del %FLAG% >nul 2>&1
<nul set /p "=!CR!!ESC![2K"

if not "!RESULT!"=="0" goto FAILED

call :GETTIME
set /a EL=NOW-T0
if !EL! lss 0 set /a EL+=8640000
set /a S=EL/100, D=(EL%%100)/10

<nul set /p "=%ESC%[?25h"
title RKM SPI 2T - ONLINE
echo   %GN%●%RS%  %WH%ONLINE%RS%   %DM%siap dalam !S!.!D! detik%RS%
echo.
echo   %DM%Tekan CTRL + C untuk menghentikan%RS%
echo.

call npm start

title RKM SPI 2T - STOPPED
echo.
echo   %RD%■%RS%  %WH%APPLICATION STOPPED%RS%
echo.
pause
exit /b

:: ---------- Jika gagal ----------
:FAILED
<nul set /p "=%ESC%[?25h"
title RKM SPI 2T - ERROR
echo   %RD%✖%RS%  %WH%Terjadi error saat memuat aplikasi%RS%
echo   %DM%detail tersimpan di %LOG%%RS%
echo.
echo   %DM%────────────────────────────────────────%RS%
type %LOG%
echo   %DM%────────────────────────────────────────%RS%
echo.
pause
exit /b

:: ---------- waktu sekarang dalam centidetik ----------
:GETTIME
set "TT=%time: =0%"
set /a "NOW=(((1!TT:~0,2!-100)*60+(1!TT:~3,2!-100))*60+(1!TT:~6,2!-100))*100+(1!TT:~9,2!-100)"
exit /b