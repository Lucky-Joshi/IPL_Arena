@echo off
title IPL Auction Arena - AI Engine
cd /d "%~dp0"
echo Starting AI decision engine on http://localhost:5000
python ai\server.py
pause
