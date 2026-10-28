@echo off
rem Gera a apresentacao Visao Operacao direto da nuvem do Jr-Oper.
rem Duplo clique = ultimo mes congelado. Ou: gerar_visao_operacao.bat 202610
chcp 65001 >nul
if not exist "%~dp0node_modules\pptxgenjs" (
  echo Instalando o pptxgenjs na primeira vez...
  rem versao fixa aqui mesmo: funciona ate sem o package.json ao lado
  call npm install --prefix "%~dp0." pptxgenjs@3.12.0 --no-audit --no-fund --no-save
)
node "%~dp0gerar_visao_operacao.js" %*
echo.
pause
