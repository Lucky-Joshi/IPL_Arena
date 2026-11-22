@echo off
title IPL Auction Arena - Verification
cd /d "%~dp0"
echo ============================================
echo  1/3  Python AI engine unit tests
echo ============================================
python -m unittest discover -s ai -p "test_*.py"
if errorlevel 1 goto failed

echo.
echo ============================================
echo  2/3  Backend end-to-end smoke tests
echo ============================================
cd /d "%~dp0backend"
call npm test
if errorlevel 1 goto failed

echo.
echo ============================================
echo  3/3  Frontend production build
echo ============================================
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 goto failed

echo.
echo ALL CHECKS PASSED
exit /b 0

:failed
echo.
echo VERIFICATION FAILED - see output above
exit /b 1
