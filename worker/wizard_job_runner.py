#!/usr/bin/env python3
import argparse
import glob
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_job(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_job(path: Path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_log(log_path: Path, line: str):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line.rstrip() + "\n")


def apply_placeholders(value, job):
    text = str(value)
    mapping = {
        "jobId": job.get("id", ""),
        "datasetPath": job.get("datasetPath", ""),
        "outputPath": job.get("outputPath", ""),
        "kind": job.get("kind", ""),
        "logPath": job.get("logPath", ""),
    }
    for key, replacement in mapping.items():
        text = text.replace("{" + key + "}", str(replacement))
    return text


def build_persona_manifest(job, log_path: Path):
    dataset_dir = Path(job.get("datasetPath", ""))
    output_dir = Path(job.get("outputPath", ""))
    if not dataset_dir.exists():
        raise FileNotFoundError(f"dataset path not found: {dataset_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for file_path in sorted(dataset_dir.rglob("*")):
        if not file_path.is_file():
            continue
        suffix = file_path.suffix.lower()
        if suffix not in {".jsonl", ".json", ".txt", ".md", ".wav", ".png", ".jpg", ".jpeg"}:
            continue
        items.append({
            "path": str(file_path),
            "suffix": suffix,
            "bytes": file_path.stat().st_size,
        })

    manifest_path = output_dir / f"{job['id']}-manifest.json"
    manifest = {
      "jobId": job["id"],
      "kind": job.get("kind"),
      "generatedAt": utc_now(),
      "count": len(items),
      "items": items,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    append_log(log_path, f"[wizard-runner] generated manifest: {manifest_path}")
    return {"manifestPath": str(manifest_path), "count": len(items)}


def collect_artifacts(job):
    output_dir = Path(job.get("outputPath", ""))
    adapter = job.get("trainerAdapter") or {}
    trainer = job.get("trainer") or {}
    patterns = adapter.get("expectedArtifacts") or trainer.get("artifactGlobs") or ["**/*.safetensors", "**/*.bin", "**/*.json"]
    artifacts = []
    if not output_dir.exists():
        return artifacts
    seen = set()
    for pattern in patterns:
        for match in glob.glob(str(output_dir / pattern), recursive=True):
            path_obj = Path(match)
            if not path_obj.is_file():
                continue
            normalized = str(path_obj.resolve())
            if normalized in seen:
                continue
            seen.add(normalized)
            artifacts.append({
                "path": normalized,
                "bytes": path_obj.stat().st_size,
            })
    return artifacts


def write_artifact_manifest(job, artifacts):
    output_dir = Path(job.get("outputPath", ""))
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / f"{job['id']}-artifacts.json"
    payload = {
        "jobId": job.get("id"),
        "kind": job.get("kind"),
        "generatedAt": utc_now(),
        "count": len(artifacts),
        "artifacts": artifacts,
    }
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def run_external_command(job, log_path: Path):
    adapter = job.get("trainerAdapter") or {}
    trainer = job.get("trainer") or {}
    command = adapter.get("resolvedCommand") or trainer.get("command") or job.get("command")
    args = adapter.get("resolvedArgs") or trainer.get("args") or job.get("args") or []
    if not command:
        raise RuntimeError("wizard command missing")

    cwd = adapter.get("resolvedCwd") or trainer.get("cwd") or job.get("outputPath") or os.getcwd()
    cwd = apply_placeholders(cwd, job)
    Path(cwd).mkdir(parents=True, exist_ok=True)
    resolved_command = apply_placeholders(command, job)
    resolved_args = [apply_placeholders(arg, job) for arg in args]
    env = os.environ.copy()
    env.update({str(key): apply_placeholders(value, job) for key, value in ((adapter.get("resolvedEnv") or trainer.get("env") or {}).items())})
    append_log(log_path, f"[wizard-runner] exec: {resolved_command} {' '.join(str(arg) for arg in resolved_args)}")
    completed = subprocess.run(
        [resolved_command, *[str(arg) for arg in resolved_args]],
        cwd=cwd,
        text=True,
        capture_output=True,
        env=env,
    )
    if completed.stdout:
        append_log(log_path, completed.stdout)
    if completed.stderr:
        append_log(log_path, completed.stderr)
    return completed.returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--log", required=True)
    args = parser.parse_args()

    job_path = Path(args.job)
    log_path = Path(args.log)
    job = read_job(job_path)
    job["status"] = "running"
    job["startedAt"] = job.get("startedAt") or utc_now()
    job["logPath"] = str(log_path)
    write_job(job_path, job)

    try:
        if job.get("kind") == "persona-dataset" and not job.get("command"):
            result = build_persona_manifest(job, log_path)
            job["notes"] = list(job.get("notes") or []) + [f"manifest_ready:{result['manifestPath']}"]
            job["status"] = "complete"
            job["exitCode"] = 0
        else:
            exit_code = run_external_command(job, log_path)
            job["exitCode"] = int(exit_code)
            job["status"] = "complete" if exit_code == 0 else "failed"
            if exit_code == 0:
                artifacts = collect_artifacts(job)
                manifest_path = write_artifact_manifest(job, artifacts)
                job["notes"] = list(job.get("notes") or []) + [f"artifacts_ready:{manifest_path}"]
        job["completedAt"] = utc_now()
    except Exception as exc:
        append_log(log_path, f"[wizard-runner] failed: {exc}")
        job["status"] = "failed"
        job["completedAt"] = utc_now()
        job["exitCode"] = 1
        job["notes"] = list(job.get("notes") or []) + [f"runner_failed:{exc}"]

    write_job(job_path, job)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
