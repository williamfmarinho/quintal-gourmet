@echo off
chcp 65001 >nul
title Quintal Gourmet - Sistema de PDV
cd /d "%~dp0"

echo.
echo   =========================================
echo      QUINTAL GOURMET - SISTEMA DE PDV
echo   =========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERRO] O Node.js nao foi encontrado nesta maquina.
  echo   Instale o Node.js em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   Instalando bibliotecas pela primeira vez, aguarde...
  call npm install
  echo.
)

echo   Abrindo o sistema no navegador...
echo   Para encerrar, feche esta janela ou tecle Ctrl + C.
echo.

REM Este atalho roda sempre no modo local, com a planilha Excel: funciona
REM sem internet, mesmo que exista um banco configurado no .env.local.
set ARMAZENAMENTO=excel

node servidor/local.js

echo.
echo   O sistema foi encerrado.
pause
