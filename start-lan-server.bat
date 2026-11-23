@echo off
REM Crossmix LAN server: needs Node.js (https://nodejs.org). Keep this window open while playing.
cd /d "%~dp0"
node tools\lan-server.js 8080
pause
