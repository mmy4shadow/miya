param(
  [ValidateSet("cpu", "vulkan")]
  [string]$Flavor = "vulkan",
  [ValidateSet("Q8_0", "F16")]
  [string]$MmprojVariant = "Q8_0",
  [switch]$SkipRuntime,
  [switch]$SkipMmproj
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $root "runtime\\vision\\llama.cpp"
$modelRoot = Join-Path $root "model\\vision\\qwen3vl_4b_instruct_q4_k_m"
$tmpRoot = Join-Path $runtimeRoot "_downloads"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

function Get-LlamaAssetUrl {
  param([string]$SelectedFlavor)

  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
  $assetName = if ($SelectedFlavor -eq "vulkan") {
    "llama-$($release.tag_name)-bin-win-vulkan-x64.zip"
  } else {
    "llama-$($release.tag_name)-bin-win-cpu-x64.zip"
  }

  $asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
  if (-not $asset) {
    throw "Could not find runtime asset $assetName in llama.cpp release $($release.tag_name)."
  }

  return @{
    Tag = $release.tag_name
    Name = $asset.name
    Url = $asset.browser_download_url
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$Destination
  )

  if (Test-Path $Destination) {
    Write-Host "[miya-vision-setup] exists: $Destination"
    return
  }

  Write-Host "[miya-vision-setup] downloading: $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Destination
}

function Get-FlavorMarkerPath {
  param([string]$RuntimeRoot)
  return (Join-Path $RuntimeRoot "miya-runtime-flavor.txt")
}

function Test-RuntimeFlavor {
  param(
    [string]$RuntimeRoot,
    [string]$SelectedFlavor
  )

  $server = Join-Path $RuntimeRoot "llama-server.exe"
  if (-not (Test-Path $server)) {
    return $false
  }

  $expectedProbe = if ($SelectedFlavor -eq "vulkan") {
    Join-Path $RuntimeRoot "ggml-vulkan.dll"
  } else {
    Join-Path $RuntimeRoot "ggml-cpu-x64.dll"
  }

  if (-not (Test-Path $expectedProbe)) {
    return $false
  }

  $marker = Get-FlavorMarkerPath -RuntimeRoot $RuntimeRoot
  if (-not (Test-Path $marker)) {
    return $false
  }

  $current = (Get-Content -Path $marker -Raw).Trim()
  return $current -eq $SelectedFlavor
}

if (-not $SkipRuntime) {
  $asset = Get-LlamaAssetUrl -SelectedFlavor $Flavor
  $zipPath = Join-Path $tmpRoot $asset.Name
  Download-File -Url $asset.Url -Destination $zipPath
  $runtimeBinary = Join-Path $runtimeRoot "llama-server.exe"
  $flavorReady = Test-RuntimeFlavor -RuntimeRoot $runtimeRoot -SelectedFlavor $Flavor
  if ($flavorReady) {
    Write-Host "[miya-vision-setup] runtime already present for flavor=$Flavor at $runtimeBinary"
  } else {
    Expand-Archive -Path $zipPath -DestinationPath $runtimeRoot -Force
    Set-Content -Path (Get-FlavorMarkerPath -RuntimeRoot $runtimeRoot) -Value $Flavor -Encoding ascii
    Write-Host "[miya-vision-setup] runtime ready under $runtimeRoot from $($asset.Tag)"
  }
}

if (-not $SkipMmproj) {
  $mmprojFile = "mmproj-Qwen3VL-4B-Instruct-$MmprojVariant.gguf"
  $mmprojUrl = "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/{0}?download=true" -f $mmprojFile
  $mmprojPath = Join-Path $modelRoot $mmprojFile
  Download-File -Url $mmprojUrl -Destination $mmprojPath
  Write-Host "[miya-vision-setup] mmproj ready at $mmprojPath"
}

Write-Host "[miya-vision-setup] completed"
