param(
  [string]$Source = (Join-Path $PSScriptRoot "..\src\dashboard\phase-one-email-logo-v2.png"),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\src\dashboard")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-PhaseOneIcon {
  param(
    [int]$Size,
    [double]$LogoWidthRatio,
    [string]$FileName
  )

  $sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
  try {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::FromArgb(255, 13, 23, 21))

        $logoWidth = [int][Math]::Round($Size * $LogoWidthRatio)
        $logoHeight = [int][Math]::Round($logoWidth * $sourceImage.Height / $sourceImage.Width)
        $logoX = [int][Math]::Round(($Size - $logoWidth) / 2)
        $logoY = [int][Math]::Round(($Size - $logoHeight) / 2)
        $graphics.DrawImage($sourceImage, $logoX, $logoY, $logoWidth, $logoHeight)
      }
      finally {
        $graphics.Dispose()
      }

      $outputPath = Join-Path $OutputDirectory $FileName
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output $outputPath
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $sourceImage.Dispose()
  }
}

New-PhaseOneIcon -Size 32 -LogoWidthRatio 0.82 -FileName "phase-one-ops-favicon-32-v1.png"
New-PhaseOneIcon -Size 180 -LogoWidthRatio 0.82 -FileName "phase-one-ops-apple-180-v1.png"
New-PhaseOneIcon -Size 192 -LogoWidthRatio 0.82 -FileName "phase-one-ops-icon-192-v1.png"
New-PhaseOneIcon -Size 512 -LogoWidthRatio 0.82 -FileName "phase-one-ops-icon-512-v1.png"
New-PhaseOneIcon -Size 512 -LogoWidthRatio 0.66 -FileName "phase-one-ops-maskable-512-v1.png"
