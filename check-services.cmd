@echo off
title IPL Auction Arena - Service Check
echo Checking AI engine (5000)...
curl -s --max-time 3 http://localhost:5000/health
echo.
echo Checking backend (4000)...
curl -s --max-time 3 http://localhost:4000/api/health
echo.
echo Checking frontend (3000)...
curl -s -o nul -w "HTTP %%{http_code}" --max-time 5 http://localhost:3000
echo.
