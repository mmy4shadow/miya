#!/usr/bin/env python3
import importlib
import inspect
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
import sys


def read_payload():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def module_available(name: str) -> bool:
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def ensure_dir(target: Path) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    return target


def pick_model(models: dict, preference: str):
    ordered = ["balanced", "fast"] if preference == "balanced" else ["fast", "balanced"]
    for key in ordered:
        info = models.get(key)
        if isinstance(info, dict) and info.get("exists") and info.get("path"):
            return key, str(info.get("path"))
    return None, ""


def main() -> int:
    payload = read_payload()
    models = payload.get("models", {}) if isinstance(payload.get("models"), dict) else {}
    image_config = payload.get("imageConfig", {}) if isinstance(payload.get("imageConfig"), dict) else {}
    input_payload = payload.get("input", {}) if isinstance(payload.get("input"), dict) else {}
    paths_payload = payload.get("paths", {}) if isinstance(payload.get("paths"), dict) else {}

    selected_key, model_path = pick_model(models, str(image_config.get("modelPreference", "fast")))
    artifact_root = ensure_dir(Path((paths_payload or {}).get("artifactRoot") or Path.cwd() / "state" / "image") / "outputs")
    stamp = time.strftime("%Y%m%dT%H%M%S")
    output_path = artifact_root / f"image-{stamp}.png"
    metadata_path = artifact_root / f"image-{stamp}.json"

    if not selected_key or not model_path or not os.path.exists(model_path):
        result = {
            "status": "unavailable",
            "code": "image_model_missing",
            "reason": "no local image model path is available",
            "models": models,
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0

    if not module_available("diffusers"):
        result = {
            "status": "unavailable",
            "code": "image_runtime_unavailable",
            "reason": "diffusers is not installed",
            "models": models,
            "selectedModel": {"profile": selected_key, "path": model_path},
            "deps": {
                "diffusers": False,
                "transformers": module_available("transformers"),
                "accelerate": module_available("accelerate"),
                "safetensors": module_available("safetensors"),
            },
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0

    import torch
    from diffusers import DiffusionPipeline

    if not torch.cuda.is_available():
        result = {
            "status": "unavailable",
            "code": "image_runtime_unavailable",
            "reason": "cuda runtime is unavailable; gpu-only image generation is required",
            "models": models,
            "selectedModel": {"profile": selected_key, "path": model_path},
            "deps": {
                "diffusers": True,
                "transformers": module_available("transformers"),
                "accelerate": module_available("accelerate"),
                "safetensors": module_available("safetensors"),
                "torch": module_available("torch"),
                "cuda": False,
            },
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0

    prompt = str(input_payload.get("prompt", "")).strip()
    negative_prompt = str(input_payload.get("negativePrompt", "")).strip()
    width = min(int(input_payload.get("width", 384) or 384), 512)
    height = min(int(input_payload.get("height", 384) or 384), 512)
    num_inference_steps = min(int(input_payload.get("steps", 2) or 2), 4)
    guidance_scale = float(input_payload.get("guidance", 0.0) or 0.0)
    seed_value = input_payload.get("seed")
    generator = None
    if seed_value is not None and str(seed_value).strip():
        try:
            generator = torch.Generator(device="cuda").manual_seed(int(seed_value))
        except Exception:
            generator = None

    pipeline = DiffusionPipeline.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
    )
    pipeline = pipeline.to("cuda")
    call_kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": num_inference_steps,
        "guidance_scale": guidance_scale,
        "generator": generator,
    }
    pipeline_parameters = inspect.signature(pipeline.__call__).parameters
    if "negative_prompt" in pipeline_parameters and negative_prompt:
        call_kwargs["negative_prompt"] = negative_prompt
    result_image = pipeline(**call_kwargs).images[0]
    result_image.save(output_path)

    metadata = {
        "status": "ok",
        "code": "image_generation_ok",
        "provider": "diffusers",
        "selectedModel": {
            "profile": selected_key,
            "path": model_path,
        },
        "artifact": {
            "imagePath": str(output_path),
            "metadataJson": str(metadata_path),
        },
        "request": {
            "prompt": prompt,
            "negativePrompt": negative_prompt,
            "width": width,
            "height": height,
            "steps": num_inference_steps,
            "guidance": guidance_scale,
            "seed": seed_value,
        },
        "observedAt": utc_now(),
        "deps": {
            "diffusers": True,
            "transformers": module_available("transformers"),
            "accelerate": module_available("accelerate"),
            "safetensors": module_available("safetensors"),
            "torch": module_available("torch"),
            "cuda": True,
        },
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    result = metadata
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
