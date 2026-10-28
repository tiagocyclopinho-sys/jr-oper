@echo off
rem Gera a apresentacao Visao Operacao direto da nuvem do Jr-Oper.
rem Duplo clique = ultimo mes congelado. Ou: gerar_visao_operacao.bat 202610
chcp 65001 >nul
if not exist "%~dp0node_modules\pptxgenjs" (
  echo Instalando o pptxgenjs na primeira vez...
  call npm install --prefix "%~dp0." --no-audit --no-fund
)
node "%~dp0gerar_visao_operacao.js" %*
echo.
pause
