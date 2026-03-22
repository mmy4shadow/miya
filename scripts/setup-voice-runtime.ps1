param(
  [string]$PythonCommand = "python",
  [switch]$SkipPip,
  [switch]$SkipTts,
  [switch]$SkipSpeaker,
  [switch]$SkipAsr,
  [string]$TtsModel = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
  [string]$AsrModel = "Systran/faster-whisper-small"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$modelRoot = Join-Path $root "model"
$audioRoot = Join-Path $modelRoot "audio"
$speakerRoot = Join-Path $modelRoot "speaker_id"
$asrRoot = Join-Path $audioRoot "faster_whisper_small"
$tmpRoot = Join-Path $audioRoot "_downloads"

New-Item -ItemType Directory -Force -Path $audioRoot | Out-Null
New-Item -ItemType Directory -Force -Path $speakerRoot | Out-Null
New-Item -ItemType Directory -Force -Path $asrRoot | Out-Null
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

function Invoke-Python {
  param([string[]]$PythonArgs)
  & $PythonCommand @PythonArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $PythonCommand $($PythonArgs -join ' ')"
  }
}

Write-Host "[miya-voice-setup] ensuring CUDA torch runtime"
Invoke-Python -PythonArgs @("-m", "pip", "install", "--no-deps", "https://download.pytorch.org/whl/cu121/torch-2.5.1%2Bcu121-cp312-cp312-win_amd64.whl")
Invoke-Python -PythonArgs @("-m", "pip", "install", "--no-deps", "https://download.pytorch.org/whl/cu121/torchaudio-2.5.1%2Bcu121-cp312-cp312-win_amd64.whl")
Invoke-Python -PythonArgs @("-m", "pip", "install", "--no-deps", "sympy==1.13.1", "setuptools==80.9.0")

if (-not $SkipPip) {
  Write-Host "[miya-voice-setup] installing pinned Python runtime packages"
  Invoke-Python -PythonArgs @("-m", "pip", "install", "--upgrade", "--upgrade-strategy", "only-if-needed", "numpy==2.2.6", "scipy==1.15.3", "huggingface_hub[hf_xet]==0.36.2", "faster-whisper==1.2.0", "soundfile==0.13.1", "librosa==0.11.0")
  Invoke-Python -PythonArgs @("-m", "pip", "install", "--upgrade", "--upgrade-strategy", "only-if-needed", "--no-deps", "qwen-tts==0.1.1")
  Invoke-Python -PythonArgs @("-m", "pip", "install", "--upgrade", "--upgrade-strategy", "only-if-needed", "modelscope", "addict", "simplejson", "sortedcontainers", "attrs", "silero-vad")
}

if (-not $SkipTts) {
  $ttsTarget = Join-Path $audioRoot "qwen3_tts_12hz_1_7b_customvoice"
  if (Test-Path (Join-Path $ttsTarget "config.json")) {
    Write-Host "[miya-voice-setup] TTS model already present at $ttsTarget"
  } else {
    New-Item -ItemType Directory -Force -Path $ttsTarget | Out-Null
    Write-Host "[miya-voice-setup] downloading TTS model $TtsModel to $ttsTarget"
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    & hf download $TtsModel --local-dir $ttsTarget
    if ($LASTEXITCODE -ne 0) {
      throw "hf download failed for $TtsModel"
    }
  }
}

if (-not $SkipAsr) {
  if (Test-Path (Join-Path $asrRoot "model.bin")) {
    Write-Host "[miya-voice-setup] ASR model already present at $asrRoot"
  } else {
    Write-Host "[miya-voice-setup] warming local ASR model cache for $AsrModel into $asrRoot"
    Invoke-Python -PythonArgs @("-c", "from faster_whisper import WhisperModel; WhisperModel('$AsrModel', device='cuda', compute_type='float16', download_root=r'$tmpRoot', local_files_only=False)")
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
