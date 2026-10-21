@echo off
title PulsAI Web Launcher
echo ============================================================
echo   PulsAI Web - Iniciando Servidor
echo ============================================================
echo.
echo Verificando dependencias...
call npm run dev -- -p 3001
pause
