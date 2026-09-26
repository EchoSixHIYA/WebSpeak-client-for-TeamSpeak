Add-Type -AssemblyName System.Drawing

$width = 3200
$height = 116
$outputPath = Join-Path $PSScriptRoot "..\docs\examples\illusia-voice\assets\footer-wave.png"
$bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$topEdge = [System.Drawing.Drawing2D.GraphicsPath]::new()
$topEdge.StartFigure()
$topEdge.AddBezier(
  [System.Drawing.PointF]::new(0, 20),
  [System.Drawing.PointF]::new(240, 4),
  [System.Drawing.PointF]::new(460, 0),
  [System.Drawing.PointF]::new(700, 10)
)
$topEdge.AddBezier(
  [System.Drawing.PointF]::new(700, 10),
  [System.Drawing.PointF]::new(1000, 26),
  [System.Drawing.PointF]::new(1200, 36),
  [System.Drawing.PointF]::new(1600, 36)
)
$topEdge.AddBezier(
  [System.Drawing.PointF]::new(1600, 36),
  [System.Drawing.PointF]::new(2000, 36),
  [System.Drawing.PointF]::new(2200, 26),
  [System.Drawing.PointF]::new(2500, 10)
)
$topEdge.AddBezier(
  [System.Drawing.PointF]::new(2500, 10),
  [System.Drawing.PointF]::new(2740, 0),
  [System.Drawing.PointF]::new(2960, 4),
  [System.Drawing.PointF]::new(3200, 20)
)

$surface = [System.Drawing.Drawing2D.GraphicsPath]::new()
$surface.AddPath($topEdge, $false)
$surface.AddLine(3200, 20, 3200, $height)
$surface.AddLine(3200, $height, 0, $height)
$surface.CloseFigure()

$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0, 0, $width, $height),
  [System.Drawing.Color]::FromArgb(138, 244, 252, 254),
  [System.Drawing.Color]::FromArgb(245, 252, 255, 255),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$blend = [System.Drawing.Drawing2D.ColorBlend]::new(3)
$blend.Colors = [System.Drawing.Color[]]@(
  [System.Drawing.Color]::FromArgb(138, 244, 252, 254),
  [System.Drawing.Color]::FromArgb(194, 248, 253, 254),
  [System.Drawing.Color]::FromArgb(245, 252, 255, 255)
)
$blend.Positions = [single[]]@(0.0, 0.58, 1.0)
$brush.InterpolationColors = $blend
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(118, 103, 210, 221), 1.5)
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(150, 99, 216, 225))
$accentPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$leftDiamond = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(126, 47),
  [System.Drawing.PointF]::new(136, 58),
  [System.Drawing.PointF]::new(126, 69),
  [System.Drawing.PointF]::new(116, 58)
)
$rightDiamond = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(3074, 47),
  [System.Drawing.PointF]::new(3084, 58),
  [System.Drawing.PointF]::new(3074, 69),
  [System.Drawing.PointF]::new(3064, 58)
)
$accentPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(94, 91, 211, 223), 1.2)
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$graphics.FillPath($brush, $surface)
$graphics.DrawPath($pen, $topEdge)
$graphics.DrawLine($accentPen, 82, 58, 116, 58)
$graphics.DrawLine($accentPen, 136, 58, 170, 58)
$graphics.DrawLine($accentPen, 3030, 58, 3064, 58)
$graphics.DrawLine($accentPen, 3084, 58, 3118, 58)
$accentPath.AddPolygon($leftDiamond)
$accentPath.AddPolygon($rightDiamond)
$graphics.FillPath($accentBrush, $accentPath)
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $outputPath)) | Out-Null
$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$accentPen.Dispose()
$accentBrush.Dispose()
$accentPath.Dispose()
$pen.Dispose()
$brush.Dispose()
$surface.Dispose()
$topEdge.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
