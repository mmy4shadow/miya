param(
  [string]$PythonCommand = "python",
  [switch]$SkipPip,
  [switch]$SkipTts,
  [switch]$SkipSpeaker,
  [string]$TtsModel = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$modelRoot = Join-Path $root "model"
$audioRoot = Join-Path $modelRoot "audio"
$speakerRoot = Join-Path $modelRoot "speaker_id"
$tmpRoot = Join-Path $audioRoot "_downloads"

New-Item -ItemType Directory -Force -Path $audioRoot | Out-Null
New-Item -ItemType Directory -Force -Path $speakerRoot | Out-Null
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

function Invoke-Python {
  param([string[]]$Args)
  & $PythonCommand @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $PythonCommand $($Args -join ' ')"
  }
}

if (-not $SkipPip) {
  Write-Host "[miya-voice-setup] installing Python runtime packages"
  Invoke-Python -Args @("-m", "pip", "install", "-U", "pip", "wheel", "setuptools")
  Invoke-Python -Args @("-m", "pip", "install", "-U", "qwen-tts", "soundfile", "librosa", "numpy", "scipy")
}

if (-not $SkipTts) {
  $ttsTarget = Join-Path $audioRoot "qwen3_tts_12hz_0_6b_base"
  if (Test-Path (Join-Path $ttsTarget "config.json")) {
    Write-Host "[miya-voice-setup] TTS model already present at $ttsTarget"
  } else {
    New-Item -ItemType Directory -Force -Path $ttsTarget | Out-Null
    Write-Host "[miya-voice-setup] downloading TTS model $TtsModel to $ttsTarget"
    Invoke-Python -Args @("-m", "huggingface_hub", "download", $TtsModel, "--local-dir", $ttsTarget)
  }
}

if (-not $SkipSpeaker) {
  $speakerCkpt = Join-Path $speakerRoot "eres2net\\eres2net_large_model.ckpt"
  if (Test-Path $speakerCkpt) {
    Write-Host "[miya-voice-setup] speaker checkpoint already present at $speakerCkpt"
  } else {
    Write-Warning "[miya-voice-setup] expected local speaker checkpoint not found: $speakerCkpt"
  }
}

Write-Host "[miya-voice-setup] completed"
