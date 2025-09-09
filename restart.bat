@echo off
echo Restarting backend server...

:: Check if the server is running on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    set PID=%%a
    goto :found
)

:found
if defined PID (
    echo Stopping server with PID: %PID%
    taskkill /F /PID %PID%
    timeout /t 2 /nobreak > nul
)

:: Start the server
echo Starting server...
start /B npm run dev

echo Server restarted successfully!
