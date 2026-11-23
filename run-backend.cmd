@echo off
title T20 Dynasty - Backend
cd /d "%~dp0backend"
echo Starting authoritative auction backend on http://localhost:4000
node server.js
pause
