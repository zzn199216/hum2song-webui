param(
  [string]$IndexPath = ".\static\pianoroll\index.html"
)

if (!(Test-Path $IndexPath)) {
  Write-Error "Index not found: $IndexPath"
  exit 1
}

$editorScript = '<script src="/static/pianoroll/controllers/editor_controller.js"></script>'
$viewScript   = '<script src="/static/pianoroll/ui/editor_view.js"></script>'

$content = Get-Content -Raw -Encoding UTF8 $IndexPath

if ($content -match [regex]::Escape($editorScript)) {
  Write-Host "editor_controller.js already present; nothing to do."
  exit 0
}

# Insert both scripts before app.js include (idempotent)
$pattern = '<script\s+src="/static/pianoroll/app\.js"\s*></script>'
if ($content -match $pattern) {
  $replacement = "$viewScript`r`n  $editorScript`r`n  $matches[0]"
  $content2 = [regex]::Replace($content, $pattern, $replacement, 1)
} else {
  # fallback: insert before closing body
  $pattern2 = '</body>'
  if ($content -match $pattern2) {
    $content2 = $content -replace $pattern2, "  $viewScript`r`n  $editorScript`r`n</body>"
  } else {
    Write-Error "Could not find app.js script tag or </body> in $IndexPath"
    exit 2
  }
}

Set-Content -Encoding UTF8 -NoNewline -Path $IndexPath -Value $content2
Write-Host ("Patched {0}: inserted editor_view + editor_controller scripts." -f $IndexPath)
