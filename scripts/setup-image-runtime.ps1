param(
  [string]$PythonCommand = "python",
  [switch]$SkipPip,
  [switch]$SkipModelCheck
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$imageRoot = Join-Path $root "model\\image"

function Invoke-Python {
  param([string[]]$PythonArgs)
  & $PythonCommand @PythonArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $PythonCommand $($PythonArgs -join ' ')"
  }
}

Write-Host "[miya-image-setup] ensuring CUDA torch runtime"
Invoke-Python -PythonArgs @("-m", "pip", "install", "--no-deps", "https://download.pytorch.org/whl/cu121/torch-2.5.1%2Bcu121-cp312-cp312-win_amd64.whl")
Invoke-Python -PythonArgs @("-m", "pip", "install", "--no-deps", "sympy==1.13.1", "setuptools==80.9.0")

if (-not $SkipPip) {
  Write-Host "[miya-image-setup] installing pinned Python runtime packages"
  Invoke-Python -PythonArgs @("-m", "pip", "install", "--upgrade", "--upgrade-strategy", "only-if-needed", "numpy==2.2.6", "huggingface_hub[hf_xet]==0.36.2", "transformers==4.57.3", "accelerate==1.12.0", "safetensors==0.7.0", "sentencepiece==0.2.1", "pillow==12.1.0")
  Invoke-Python -PythonArgs @("-m", "pip", "install", "--upgrade", "--upgrade-strategy", "only-if-needed", "--no-deps", "diffusers==0.37.0")
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
