@echo off
rem Gera a planilha de requisitos (motoristas e ajudantes) direto da nuvem do Jr-Oper.
rem Duplo clique = mes de fechamento atual. Ou: gerar_planilha_requisitos.bat 202610
chcp 65001 >nul
node "%~dp0gerar_planilha_requisitos.js" %*
echo.
pause
