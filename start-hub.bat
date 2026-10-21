@echo off
title PulsAI Hub - Gateway + Tunnel
cd /d "%~dp0"
echo ============================================================
echo      PULSAI HUB: CONECTANDO CON VERCEL
echo ============================================================
echo.

:: 1. Iniciar Gateway en segundo plano
start "PulsAI-Gateway" /B node "..\new-twtr\gateway\pulsai-gateway.mjs"

:: 2. Esperar 2 segundos
timeout /t 2 >nul

:: 3. Iniciar sincronizador de tunel hacia Vercel
node connect-tunnel.mjs
pause
