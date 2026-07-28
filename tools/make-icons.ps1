# Rigenera le icone da tools/icon.svg: render a 512px con Edge headless,
# poi downscale a 192 e 180 con System.Drawing. Nessuna dipendenza.

$root = Split-Path $PSScriptRoot -Parent
$svg = Join-Path $PSScriptRoot "icon.svg"
$outDir = Join-Path $root "icons"
New-Item -ItemType Directory -Force $outDir | Out-Null
$png512 = Join-Path $outDir "icon-512.png"

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
& $edge --headless --disable-gpu --screenshot="$png512" --window-size=512,512 "file:///$($svg -replace '\\','/')" 2>&1 | Out-Null
Start-Sleep -Seconds 2
Write-Output "scritta $png512"

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($png512)
foreach ($size in 192, 180) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.SmoothingMode = 'HighQuality'
    $g.DrawImage($src, 0, 0, $size, $size)
    $path = Join-Path $outDir "icon-$size.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "scritta $path"
}
$src.Dispose()
