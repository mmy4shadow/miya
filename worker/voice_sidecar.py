#!/usr/bin/env python3
import importlib
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
import librosa
import sys

_SPEAKER_EMBEDDER = None
_SPEAKER_EMBEDDER_PATH = None
_VAD_MODEL = None


def read_payload():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def ensure_dir(target: Path) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    return target


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_artifact_paths(paths_payload, action: str):
    artifact_root = Path((paths_payload or {}).get("artifactRoot") or Path.cwd() / "state" / "voice")
    action_root = ensure_dir(artifact_root / action)
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    base = f"{action}-{stamp}"
    return {
        "root": action_root,
        "base": base,
        "json": action_root / f"{base}.json",
        "wav": action_root / f"{base}.wav",
    }


def ensure_sox_on_path(paths_payload):
    plugin_root = (paths_payload or {}).get("pluginRoot")
    candidates = []
    if plugin_root:
        candidates.append(Path(plugin_root) / "runtime" / "voice" / "sox" / "dist" / "sox-14.4.2")

    for candidate in candidates:
        sox_exe = candidate / "sox.exe"
        if sox_exe.is_file():
            current_path = os.environ.get("PATH", "")
            candidate_text = str(candidate)
            if candidate_text not in current_path:
                os.environ["PATH"] = f"{candidate_text};{current_path}"
            return str(sox_exe)
    return None


def transcribe_audio(audio_path: str, model_path: str, artifact_json: Path):
    if not audio_path or not os.path.exists(audio_path):
        return {
            "status": "error",
            "code": "audio_input_missing",
            "reason": f"audio input not found: {audio_path}",
        }

    if not module_available("faster_whisper"):
        return {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": "faster-whisper is not installed",
        }

    from faster_whisper import WhisperModel

    model_ref = model_path if model_path and os.path.exists(model_path) else "small"
    download_root = str(artifact_json.parent.parent / "_downloads")
    device = "cuda" if module_available("torch") else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel(model_ref, device=device, compute_type=compute_type, download_root=download_root)
    segments, info = model.transcribe(audio_path, beam_size=5)
    segment_list = []
    text_parts = []
    for segment in segments:
        segment_list.append({
            "start": float(segment.start),
            "end": float(segment.end),
            "text": segment.text,
        })
        text_parts.append(segment.text.strip())

    transcript = " ".join(part for part in text_parts if part).strip()
    result = {
        "status": "ok",
        "code": "transcription_ok",
        "text": transcript,
        "language": getattr(info, "language", None),
        "durationSeconds": getattr(info, "duration", None),
        "segments": segment_list,
        "provider": "faster-whisper",
        "modelRef": model_ref,
    }
    write_json(artifact_json, result)
    result["artifact"] = {"transcriptJson": str(artifact_json)}
    return result


def detect_vad(audio_path: str, artifact_json: Path):
    if not audio_path or not os.path.exists(audio_path):
        return {
            "status": "error",
            "code": "audio_input_missing",
            "reason": f"audio input not found: {audio_path}",
        }

    neural_result = detect_vad_silero(audio_path)
    if neural_result is not None:
        write_json(artifact_json, neural_result)
        neural_result["artifact"] = {"vadJson": str(artifact_json)}
        return neural_result

    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    intervals = librosa.effects.split(audio, top_db=28, hop_length=160, frame_length=400)
    segments = []
    voiced_samples = 0
    for start, end in intervals.tolist():
        voiced_samples += max(0, end - start)
        segment = audio[start:end]
        rms = float(np.sqrt(np.mean(np.square(segment)))) if segment.size else 0.0
        segments.append({
            "start": round(start / sr, 4),
            "end": round(end / sr, 4),
            "duration": round((end - start) / sr, 4),
            "rms": rms,
        })

    duration_seconds = float(len(audio) / sr) if sr else 0.0
    speech_ratio = float(voiced_samples / max(len(audio), 1))
    result = {
        "status": "ok",
        "code": "vad_ok",
        "provider": "librosa-energy-vad",
        "sampleRate": sr,
        "durationSeconds": duration_seconds,
        "speechSeconds": round(voiced_samples / sr, 4) if sr else 0.0,
        "speechRatio": round(speech_ratio, 4),
        "speechDetected": speech_ratio > 0.02,
        "segments": segments,
    }
    write_json(artifact_json, result)
    result["artifact"] = {"vadJson": str(artifact_json)}
    return result


def get_vad_model():
    global _VAD_MODEL
    if not module_available("silero_vad"):
        return None, "silero_vad_not_installed"

    try:
        import torch
        from silero_vad import load_silero_vad
    except Exception as exc:
        return None, f"silero_vad_import_failed:{exc}"

    try:
        if _VAD_MODEL is None:
            _VAD_MODEL = load_silero_vad(onnx=False)
        if torch.cuda.is_available():
            _VAD_MODEL = _VAD_MODEL.to("cuda")
            return _VAD_MODEL, "silero-vad:cuda:0"
        return _VAD_MODEL, "silero-vad:cpu"
    except Exception as exc:
        return None, f"silero_vad_load_failed:{exc}"


def detect_vad_silero(audio_path: str):
    model, provider = get_vad_model()
    if model is None:
        return None

    try:
        import torch
        from silero_vad import get_speech_timestamps, read_audio

        audio = read_audio(audio_path, sampling_rate=16000)
        if torch.cuda.is_available():
            audio = audio.to("cuda")
        timestamps = get_speech_timestamps(audio, model, sampling_rate=16000)
        duration_seconds = float(audio.shape[-1] / 16000) if audio.shape[-1] else 0.0
        speech_samples = 0
        segments = []
        for item in timestamps:
            start = int(item.get("start", 0))
            end = int(item.get("end", start))
            speech_samples += max(0, end - start)
            segments.append({
                "start": round(start / 16000, 4),
                "end": round(end / 16000, 4),
                "duration": round((end - start) / 16000, 4),
            })

        speech_ratio = float(speech_samples / max(int(audio.shape[-1]), 1))
        return {
            "status": "ok",
            "code": "vad_ok",
            "provider": provider,
            "sampleRate": 16000,
            "durationSeconds": round(duration_seconds, 4),
            "speechSeconds": round(speech_samples / 16000, 4),
            "speechRatio": round(speech_ratio, 4),
            "speechDetected": speech_ratio > 0.02,
            "segments": segments,
        }
    except Exception:
        return None


def synthesize_tts(text: str, voice_id: str, model_path: str, artifact_paths, paths_payload):
    if not text.strip():
        return {
            "status": "error",
            "code": "tts_failed",
            "reason": "text is required",
        }

    if not module_available("qwen_tts"):
        return {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": "qwen_tts is not installed",
        }

    if not model_path or not os.path.exists(model_path) or not os.path.exists(os.path.join(model_path, "config.json")):
        return {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": f"local qwen tts model is missing or incomplete: {model_path}",
        }

    import torch
    from qwen_tts import Qwen3TTSModel

    sox_path = ensure_sox_on_path(paths_payload)
    if not sox_path:
        return {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": "sox.exe is not installed under miya/runtime/voice/sox",
        }

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
    model = Qwen3TTSModel.from_pretrained(
        model_path,
        device_map=device_map,
        dtype=dtype,
    )
    wavs, sr = model.generate_custom_voice(
        text=[text],
        language=["Chinese"],
        speaker=[voice_id or "Vivian"],
    )
    sf.write(str(artifact_paths["wav"]), wavs[0], sr)
    result = {
        "status": "ok",
        "code": "tts_ok",
        "provider": "qwen-tts",
        "voiceId": voice_id or "Vivian",
        "sampleRate": sr,
        "artifact": {"audioPath": str(artifact_paths["wav"])},
    }
    write_json(artifact_paths["json"], result)
    result["artifact"]["metadataJson"] = str(artifact_paths["json"])
    return result


def mfcc_signature(audio_path: str):
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    mfcc = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=20)
    return np.mean(mfcc, axis=1)


def cosine_similarity(left, right):
    left_norm = np.linalg.norm(left)
    right_norm = np.linalg.norm(right)
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return float(np.dot(left, right) / (left_norm * right_norm))


def get_speaker_embedder(speaker_asset_path: str):
    global _SPEAKER_EMBEDDER, _SPEAKER_EMBEDDER_PATH
    if not module_available("modelscope"):
        return None, "modelscope_not_installed"

    try:
        from modelscope.pipelines import pipeline
    except Exception as exc:
        return None, f"modelscope_import_failed:{exc}"

    try:
        if _SPEAKER_EMBEDDER is None or _SPEAKER_EMBEDDER_PATH != speaker_asset_path:
            _SPEAKER_EMBEDDER = pipeline(
                task="speaker-verification",
                model=speaker_asset_path,
            )
            _SPEAKER_EMBEDDER_PATH = speaker_asset_path
        return _SPEAKER_EMBEDDER, "eres2net-embedding"
    except Exception as exc:
        return None, f"modelscope_pipeline_failed:{exc}"


def embedding_signature(audio_path: str, speaker_asset_path: str):
    verifier, provider = get_speaker_embedder(speaker_asset_path)
    if verifier is None:
        return None, provider

    try:
        audio, _ = librosa.load(audio_path, sr=16000, mono=True)
        embedding = verifier.model.forward(audio)
        if hasattr(embedding, "detach"):
            embedding = embedding.detach().cpu().numpy()
        embedding = np.asarray(embedding, dtype=np.float32).reshape(-1)
        if embedding.size == 0:
            return None, "eres2net_empty_embedding"
        device = getattr(verifier.model, "device", "unknown")
        return embedding, f"{provider}:{device}"
    except Exception as exc:
        return None, f"modelscope_embedding_failed:{exc}"


def identify_speaker(enroll_audio_path: str, input_audio_path: str, speaker_asset_path: str, artifact_json: Path):
    if not input_audio_path or not os.path.exists(input_audio_path):
        return {
            "status": "error",
            "code": "audio_input_missing",
            "reason": f"speaker input not found: {input_audio_path}",
        }

    references = []
    if enroll_audio_path and os.path.exists(enroll_audio_path):
        references.append(("enroll", enroll_audio_path))
    elif speaker_asset_path and os.path.isdir(speaker_asset_path):
        for name in sorted(os.listdir(speaker_asset_path)):
            if name.lower().endswith(".wav"):
                references.append((Path(name).stem, os.path.join(speaker_asset_path, name)))
        example_dir = os.path.join(speaker_asset_path, "examples")
        if os.path.isdir(example_dir):
            for name in sorted(os.listdir(example_dir)):
                if name.lower().endswith(".wav"):
                    references.append((Path(name).stem, os.path.join(example_dir, name)))

    if not references:
        return {
            "status": "unavailable",
            "code": "speaker_reference_missing",
            "reason": "no enrollment audio or reference speaker assets were found",
        }

    input_sig, provider = embedding_signature(input_audio_path, speaker_asset_path)
    if input_sig is None:
        input_sig = mfcc_signature(input_audio_path)
        provider = "mfcc-reference-match"
    scored = []
    for label, ref_path in references:
        try:
            ref_sig, ref_provider = embedding_signature(ref_path, speaker_asset_path)
            if ref_sig is None:
                ref_sig = mfcc_signature(ref_path)
                ref_provider = "mfcc-reference-match"
            scored.append({
                "label": label,
                "path": ref_path,
                "score": cosine_similarity(input_sig, ref_sig),
                "embeddingProvider": ref_provider,
            })
        except Exception:
            continue

    if not scored:
        return {
            "status": "error",
            "code": "speaker_identify_failed",
            "reason": "failed to score any reference audio",
        }

    scored.sort(key=lambda item: item["score"], reverse=True)
    best = scored[0]
    result = {
        "status": "ok",
        "code": "speaker_identify_ok",
        "provider": provider,
        "bestMatch": best,
        "candidates": scored[:5],
    }
    write_json(artifact_json, result)
    result["artifact"] = {"matchJson": str(artifact_json)}
    return result


def main() -> int:
    payload = read_payload()
    action = str(payload.get("action", "")).strip()
    assets = payload.get("assets", {}) if isinstance(payload.get("assets"), dict) else {}
    input_payload = payload.get("input", {}) if isinstance(payload.get("input"), dict) else {}
    paths_payload = payload.get("paths", {}) if isinstance(payload.get("paths"), dict) else {}
    voice_payload = payload.get("voice", {}) if isinstance(payload.get("voice"), dict) else {}

    has_qwen_tts = module_available("qwen_tts")
    has_numpy = module_available("numpy")
    has_soundfile = module_available("soundfile")
    artifacts = build_artifact_paths(paths_payload, action or "voice")
    sox_exe = ensure_sox_on_path(paths_payload)

    if action == "transcribe":
        result = transcribe_audio(
            str(input_payload.get("audioPath", "")),
            str(((voice_payload.get("asr") or {}).get("modelPath")) if isinstance(voice_payload.get("asr"), dict) else ""),
            artifacts["json"],
        )
    elif action == "vad":
        result = detect_vad(
            str(input_payload.get("audioPath", "")),
            artifacts["json"],
        )
    elif action == "synthesize":
        result = synthesize_tts(
            str(input_payload.get("text", "")),
            str(input_payload.get("voiceId", "")),
            str(((voice_payload.get("tts") or {}).get("modelPath")) if isinstance(voice_payload.get("tts"), dict) else ""),
            artifacts,
            paths_payload,
        )
    else:
        result = identify_speaker(
            str(input_payload.get("enrollAudioPath", "")),
            str(input_payload.get("inputAudioPath", "")),
            str((assets.get("speakerId") or {}).get("path", "")) if isinstance(assets.get("speakerId"), dict) else "",
            artifacts["json"],
        )

    result.update({
        "action": action,
        "assets": assets,
        "deps": {
            "qwen_tts": has_qwen_tts,
            "modelscope": module_available("modelscope"),
            "numpy": has_numpy,
            "soundfile": has_soundfile,
            "faster_whisper": module_available("faster_whisper"),
            "librosa": module_available("librosa"),
            "sox": bool(sox_exe),
        },
        "observedAt": utc_now(),
    })

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
