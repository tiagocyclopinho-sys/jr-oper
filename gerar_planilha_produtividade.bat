@echo off
rem Gera a planilha de pagamento de produtividade direto da nuvem do Jr-Oper.
rem Duplo clique = mes de fechamento mais recente. Ou: gerar_planilha_produtividade.bat 202610
chcp 65001 >nul
node "%~dp0gerar_planilha_produtividade.js" %*
echo.
pause
