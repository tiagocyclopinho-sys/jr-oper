# Parte do atualizar_cadastro_requisitos.js: aplica o plano (JSON) na planilha
# de requisitos pelo proprio Excel, para preservar formato, formulas e tabelas.
param([string]$arqPlano)
$ErrorActionPreference = 'Stop'
$plano = Get-Content -Raw -Encoding UTF8 $arqPlano | ConvertFrom-Json

function Chave([string]$s) {
  $n = ($s -replace '\s+', ' ').Trim().ToUpperInvariant().Normalize([Text.NormalizationForm]::FormD)
  -join ($n.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
}
# O Excel recusa chamadas enquanto calcula: repete por ate 2 minutos.
function Tenta([scriptblock]$b) {
  for ($t = 0; $t -lt 240; $t++) {
    try { return & $b } catch { if ($_.Exception.Message -match '0x80010001|0x8001010A') { Start-Sleep -Milliseconds 500 } else { throw } }
  }
  throw 'Excel ocupado'
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = Tenta { $xl.Workbooks.Open($plano.planilha, 0, $false) }
  $c = $plano.col

  # --- Aba Ajudante / Motorista
  $ws = Tenta { $wb.Worksheets.Item($plano.aba) }
  $prim = [int]$plano.cabecalho + 1
  function Ultima { [int](Tenta { $ws.Cells($ws.Rows.Count, $c.nome).End(-4162).Row }) }

  foreach ($n in $plano.sair) {
    for ($r = Ultima; $r -ge $prim; $r--) {
      if ((Chave ([string](Tenta { $ws.Range("$($c.nome)$r").Value2 }))) -eq (Chave $n)) { Tenta { $ws.Rows($r).Delete() } | Out-Null; Write-Host "  $($plano.aba): saiu $n"; break }
    }
  }
  foreach ($e in $plano.entrar) {
    $ult = Ultima
    $p = $ult + 1
    for ($r = $prim; $r -le $ult; $r++) {
      if ([string]::CompareOrdinal((Chave ([string](Tenta { $ws.Range("$($c.nome)$r").Value2 }))), (Chave $e.nome)) -gt 0) { $p = $r; break }
    }
    Tenta { $ws.Rows($p).Insert() } | Out-Null
    $src = if ($p -gt $prim) { $p - 1 } else { $p + 1 }
    Tenta { $ws.Rows($src).Copy($ws.Rows($p)) } | Out-Null
    Tenta { $ws.Range("$($c.cod)$p").Value2 = [double]$e.cod } | Out-Null
    Tenta { $ws.Range("$($c.nome)$p").Value2 = [string]$e.nome } | Out-Null
    Tenta { $ws.Range("$($c.cidade)$p").Value2 = ([string]$e.cidade).ToUpperInvariant() } | Out-Null
    if ($e.dias) { Tenta { $ws.Range("$($c.dias)$p").Value2 = [double]$e.dias } | Out-Null }
    Write-Host "  $($plano.aba): entrou $($e.nome) na linha $p$(if ($e.dias) { " com $($e.dias) dia(s)" })"
  }
  # Numeracao da coluna A.
  $seq = 0
  for ($r = $prim; $r -le (Ultima); $r++) {
    if ([string](Tenta { $ws.Range("$($c.nome)$r").Value2 })) { $seq++; Tenta { $ws.Range("$($c.num)$r").Value2 = [double]$seq } | Out-Null }
  }

  # --- BD (so colunas B a F; as listas ao lado ficam paradas)
  $bd = Tenta { $wb.Worksheets.Item('BD') }
  function UltimaBd { [int](Tenta { $bd.Cells($bd.Rows.Count, 'B').End(-4162).Row }) }
  foreach ($n in $plano.sairBd) {
    for ($r = UltimaBd; $r -ge 2; $r--) {
      if ((Chave ([string](Tenta { $bd.Range("B$r").Value2 }))) -eq (Chave $n) -and (Chave ([string](Tenta { $bd.Range("D$r").Value2 }))) -eq $plano.funcao) {
        Tenta { $bd.Range("B${r}:F${r}").Delete(-4162) } | Out-Null; Write-Host "  BD: saiu $n"; break
      }
    }
  }
  foreach ($e in $plano.entrarBd) {
    $ult = UltimaBd
    $p = 0; $fimBloco = 0
    for ($r = 2; $r -le $ult; $r++) {
      if ((Chave ([string](Tenta { $bd.Range("D$r").Value2 }))) -ne $plano.funcao) { continue }
      $fimBloco = $r
      if (-not $p -and [string]::CompareOrdinal((Chave ([string](Tenta { $bd.Range("B$r").Value2 }))), (Chave $e.nome)) -gt 0) { $p = $r }
    }
    if (-not $p) { $p = if ($fimBloco) { $fimBloco + 1 } else { $ult + 1 } }
    Tenta { $bd.Range("B${p}:F${p}").Insert(-4121) } | Out-Null
    Tenta { $bd.Range("B$p").Value2 = [string]$e.nome } | Out-Null
    Tenta { $bd.Range("C$p").Value2 = [double]$e.cod } | Out-Null
    Tenta { $bd.Range("D$p").Value2 = [string]$plano.funcao } | Out-Null
    Tenta { $bd.Range("E$p").Value2 = ([string]$e.cidade).ToUpperInvariant() } | Out-Null
    Write-Host "  BD: entrou $($e.nome) na linha $p"
  }

  Tenta { $xl.CalculateFull() } | Out-Null
  Tenta { $wb.Save() } | Out-Null
  Tenta { $wb.Close($false) } | Out-Null
} finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
