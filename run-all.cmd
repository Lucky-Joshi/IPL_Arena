@echo off
title T20 Dynasty - Launcher
cd /d "%~dp0"
echo Launching T20 Dynasty services...
start "" "%~dp0run-ai.cmd"
start "" "%~dp0run-backend.cmd"
start "" "%~dp0run-frontend.cmd"
echo.
echo AI engine:     http://localhost:5000
echo Backend API:   http://localhost:4000
echo Frontend app:  http://localhost:3000
echo.
echo Open http://localhost:3000 once all three windows are ready.
