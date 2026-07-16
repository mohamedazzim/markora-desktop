[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath([System.Drawing.RectangleF]$Rectangle, [float]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconPng([int]$Size) {
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $scale = [float]$Size / 512

  $backgroundRectangle = [System.Drawing.RectangleF]::new(16 * $scale, 16 * $scale, 480 * $scale, 480 * $scale)
  $backgroundPath = New-RoundedRectanglePath $backgroundRectangle (112 * $scale)
  $backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $backgroundRectangle,
    [System.Drawing.ColorTranslator]::FromHtml('#312e81'),
    [System.Drawing.ColorTranslator]::FromHtml('#0f766e'),
    45
  )
  $graphics.FillPath($backgroundBrush, $backgroundPath)

  $page = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $page.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(146 * $scale, 102 * $scale),
    [System.Drawing.PointF]::new(310 * $scale, 102 * $scale),
    [System.Drawing.PointF]::new(388 * $scale, 180 * $scale),
    [System.Drawing.PointF]::new(388 * $scale, 410 * $scale),
    [System.Drawing.PointF]::new(146 * $scale, 410 * $scale)
  ))
  $pageBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(247, 255, 255, 255))
  $graphics.FillPath($pageBrush, $page)

  $fold = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $fold.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(310 * $scale, 102 * $scale),
    [System.Drawing.PointF]::new(310 * $scale, 180 * $scale),
    [System.Drawing.PointF]::new(388 * $scale, 180 * $scale)
  ))
  $foldBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#c7d2fe'))
  $graphics.FillPath($foldBrush, $fold)

  $markPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#312e81'), [Math]::Max(1.6, 30 * $scale))
  $markPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $markPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $markPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($markPen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(196 * $scale, 302 * $scale),
    [System.Drawing.PointF]::new(196 * $scale, 202 * $scale),
    [System.Drawing.PointF]::new(250 * $scale, 264 * $scale),
    [System.Drawing.PointF]::new(304 * $scale, 202 * $scale),
    [System.Drawing.PointF]::new(304 * $scale, 302 * $scale)
  ))

  $arrowPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#0f766e'), [Math]::Max(1.6, 26 * $scale))
  $arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $arrowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLine($arrowPen, 250 * $scale, 326 * $scale, 250 * $scale, 388 * $scale)
  $graphics.DrawLines($arrowPen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(216 * $scale, 356 * $scale),
    [System.Drawing.PointF]::new(250 * $scale, 390 * $scale),
    [System.Drawing.PointF]::new(284 * $scale, 356 * $scale)
  ))

  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()

  $stream.Dispose()
  $arrowPen.Dispose()
  $markPen.Dispose()
  $foldBrush.Dispose()
  $fold.Dispose()
  $pageBrush.Dispose()
  $page.Dispose()
  $backgroundBrush.Dispose()
  $backgroundPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  Write-Output -NoEnumerate $bytes
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildDirectory = Join-Path $projectRoot 'build'
[void](New-Item -ItemType Directory -Path $buildDirectory -Force)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @($sizes | ForEach-Object { New-IconPng $_ })
$iconPath = Join-Path $buildDirectory 'icon.ico'
$stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$images.Count)
  $offset = 6 + (16 * $images.Count)
  for ($index = 0; $index -lt $images.Count; $index++) {
    $size = $sizes[$index]
    $dimension = if ($size -eq 256) { 0 } else { $size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$index].Length)
    $writer.Write([uint32]$offset)
    $offset += $images[$index].Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image) }
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

[IO.File]::WriteAllBytes((Join-Path $buildDirectory 'icon-256.png'), $images[-1])
Write-Host "Generated $iconPath with $($images.Count) PNG resolutions."
