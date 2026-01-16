# scripts/apply_r7b_timeline_runtime_tags.ps1
$ErrorActionPreference = "Stop"

$IndexPath = Join-Path $PSScriptRoot "..\static\pianoroll\index.html"
if(!(Test-Path $IndexPath)){
  throw "index.html not found: $IndexPath"
}

$src = Get-Content $IndexPath -Raw

# Already patched?
if($src -match '/static/pianoroll/core/timeline_math\.js' -and $src -match '/static/pianoroll/controllers/timeline_runtime\.js'){
  Write-Host ("Already patched: {0}" -f $IndexPath)
  exit 0
}

$insert = @"
  <script src="/static/pianoroll/core/timeline_math.js"></script>
  <script src="/static/pianoroll/controllers/timeline_runtime.js"></script>

"@

$pattern = '<script\s+src="/static/pianoroll/timeline_controller\.js"\s*></script>'
if($src -notmatch $pattern){
  throw "Cannot find timeline_controller.js script tag in index.html"
}

$src2 = $src -replace $pattern, ($insert + '  <script src="/static/pianoroll/timeline_controller.js"></script>')
Set-Content -Path $IndexPath -Value $src2 -Encoding UTF8

Write-Host ("Patched {0}: inserted timeline_math + timeline_runtime." -f $IndexPath)
