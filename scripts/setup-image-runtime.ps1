param(
  [string]$PythonCommand = "python",
  [switch]$SkipPip,
  [switch]$SkipModelCheck
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$imageRoot = Join-Path $root "model\\image"

function Invoke-Python {
  param([string[]]$Args)
  & $PythonCommand @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $PythonCommand $($Args -join ' ')"
  }
}

if (-not $SkipPip) {
  Write-Host "[miya-image-setup] installing Python runtime packages"
  Invoke-Python -Args @("-m", "pip", "install", "-U", "pip", "wheel", "setuptools")
  Invoke-Python -Args @("-m", "pip", "install", "-U", "diffusers", "transformers", "accelerate", "safetensors", "sentencepiece")
}

if (-not $SkipModelCheck) {
  $required = @(
    (Join-Path $imageRoot "flux_1_schnell\\model_index.json"),
    (Join-Path $imageRoot "flux_2_klein_4b_apache2\\model_index.json")
  )

  foreach ($path in $required) {
    if (Test-Path $path) {
      Write-Host "[miya-image-setup] found: $path"
    } else {
      Write-Warning "[miya-image-setup] missing expected model asset: $path"
    }
  }
}

Write-Host "[miya-image-setup] completed"
