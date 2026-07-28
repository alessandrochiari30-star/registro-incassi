# Genera le icone PNG dell'app (sfondo scuro, simbolo €) senza dipendenze.
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($size in 180, 192, 512) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAlias'
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml("#1a1a19"))

    # cerchio accent
    $accent = [System.Drawing.ColorTranslator]::FromHtml("#3987e5")
    $brush = New-Object System.Drawing.SolidBrush($accent)
    $m = [int]($size * 0.12)
    $g.FillEllipse($brush, $m, $m, $size - 2 * $m, $size - 2 * $m)

    # simbolo €
    $font = New-Object System.Drawing.Font("Segoe UI", [int]($size * 0.42), [System.Drawing.FontStyle]::Bold)
    $white = [System.Drawing.Brushes]::White
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'
    $fmt.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF(0, ($size * 0.02), $size, $size)
    $g.DrawString([char]0x20AC, $font, $white, $rect, $fmt)

    $path = Join-Path $outDir "icon-$size.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "scritta $path"
}
