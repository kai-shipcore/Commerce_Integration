@echo off
setlocal

set "ROOT=%~dp0"
set "LOCAL_NODE=%ROOT%.tools\node-v22.22.2-win-x64"
set "LOCAL_NEXT=%ROOT%node_modules\next\dist\bin\next"
set "BUILD_ID=%ROOT%.next\BUILD_ID"

if exist "%LOCAL_NODE%\node.exe" (
  echo Starting Commerce Integration local server with local Node 22...
  echo.
  echo Web: http://localhost:3000
  cd /d "%ROOT%"
  if not exist "%BUILD_ID%" (
    echo No production build found. Running next build first...
    "%LOCAL_NODE%\node.exe" "%LOCAL_NEXT%" build
    if errorlevel 1 exit /b %errorlevel%
  )
  "%LOCAL_NODE%\node.exe" "%LOCAL_NEXT%" start
) else (
  call "%ROOT%scripts\start-dev.cmd"
)
