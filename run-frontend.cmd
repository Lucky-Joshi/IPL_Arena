@echo off
title T20 Dynasty - Frontend
cd /d "%~dp0frontend"
if not exist node_modules call npm install
echo Starting Next.js frontend on http://localhost:3000
call npm run dev
pause
