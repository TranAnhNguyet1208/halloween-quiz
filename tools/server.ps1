# May chu tinh cuc bo cho game Do Vui Tranh Bien - Halloween (chi phuc vu tren chinh may nay).
# Chay qua start-game.bat. Khong can Internet, khong can cai them phan mem.
param([int]$Port = 8765, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$url = "http://localhost:$Port/"

# Neu game da chay san (cua so khac) thi chi mo trinh duyet.
try {
  $probe = Invoke-WebRequest -Uri ($url + 'js/config.js') -UseBasicParsing -TimeoutSec 2
  if ($probe.Content -match 'HQ_CONFIG') {
    Write-Host "Game da dang chay tai $url - mo trinh duyet..."
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
  }
} catch { }

if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) {
  Write-Host "[LOI] Khong tim thay index.html trong $root" -ForegroundColor Red
  exit 3
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  Write-Host "[LOI] Khong mo duoc cong $Port." -ForegroundColor Red
  Write-Host "Co the cong dang bi chuong trinh khac su dung. Dong chuong trinh do roi chay lai."
  Write-Host "KHONG doi sang cong khac giua su kien: du lieu luu cua trinh duyet gan voi dia chi $url"
  Write-Host ("Chi tiet: " + $_.Exception.Message)
  exit 2
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'
  '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'
}

Write-Host ""
Write-Host "  Game dang chay tai: $url" -ForegroundColor Green
Write-Host "  Thu muc game     : $root"
Write-Host "  GIU CUA SO NAY MO. Dong cua so nay = tat may chu game."
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      $inside = $full.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
      if (($ctx.Request.HttpMethod -ne 'GET' -and $ctx.Request.HttpMethod -ne 'HEAD') -or -not $inside -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 - Khong tim thay')
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
      }
      $res.Headers['Cache-Control'] = 'no-store'
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } catch {
      Write-Host ("Loi khi phuc vu yeu cau: " + $_.Exception.Message)
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
