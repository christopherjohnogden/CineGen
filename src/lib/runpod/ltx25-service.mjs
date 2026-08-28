import workflowTemplate from './ltx25-workflow.json' with { type: 'json' };
import sdxlWorkflowTemplate from './sdxl-workflow.json' with { type: 'json' };
import qwenImageEditWorkflowTemplate from './qwen-image-edit-workflow.json' with { type: 'json' };
export const LTX25_WORKER_RELEASE = 'v5.9.0';
export const LTX25_WORKER_COMMIT = '26a9e5b7b88db76d66c0480ce561f7e98d6a1b81';
export const LTX25_WORKER_IMAGE = 'notrius/ltx-2.5-serverless:cu130@sha256:73d1621ef915ae6a149f2a32f6c317dfc89f12075ed4b3abd7df707420267205';
const RUNPOD_REST_URL = 'https://rest.runpod.io/v1';
const RUNPOD_REST_V2_URL = 'https://api.runpod.io/v2';
const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';
const POD_PORT = 8000;
const POD_LOG_MAX_BYTES = 256 * 1024;
const POD_LOG_MAX_WAIT_MS = 1800;
const POD_LOG_QUIET_MS = 200;
const RUNPOD_REQUEST_TIMEOUT_MS = 15_000;
const POD_HEALTH_TIMEOUT_MS = 6_500;
const POD_SUBMISSION_TIMEOUT_MS = 120_000;
const MAX_PROMPT_CHARS = 12_000;
// The gateway accepts a 20 MiB JSON body. Keep enough headroom for base64 expansion
// and the workflow itself so every reference accepted here can actually be submitted.
const MAX_REFERENCE_BYTES = 14 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const ARTIFACT_CHUNK_BYTES = 1024 * 1024;
const ARTIFACT_DOWNLOAD_CONCURRENCY = 4;
const IMAGE_MODEL_IDS = Object.freeze(['sdxl', 'qwen-image-edit']);
// ComfyUI's current LoadImage implementation routes stills through PyAV. A
// 1x1 grayscale placeholder is not a valid video frame there, so use a small,
// canonical RGB PNG and switch the workflow to its text-to-video branch.
const DEFAULT_FRAME = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR4nO3PQQ0AIBDAMMD4WUcEj4ZkVbDtmVk/OzrgVQNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgPaBRFyAf0dnk7yAAAAAElFTkSuQmCC';
export const DEFAULT_LTX25_GPU_PROFILE = 'balanced';
export const LTX25_GPU_PROFILES = Object.freeze({
    economy: Object.freeze({
        gpuTypeIds: Object.freeze([
            'NVIDIA A40',
            'NVIDIA RTX A6000',
            'NVIDIA L40',
            'NVIDIA L40S',
            'NVIDIA RTX 6000 Ada Generation',
        ]),
        containerDiskInGb: 120,
        minRAMPerGPU: 48,
        minVCPUPerGPU: 8,
    }),
    balanced: Object.freeze({
        gpuTypeIds: Object.freeze([
            'NVIDIA RTX PRO 6000 Blackwell Server Edition',
            'NVIDIA RTX PRO 6000 Blackwell Workstation Edition',
            'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition',
        ]),
        containerDiskInGb: 120,
        minRAMPerGPU: 64,
        minVCPUPerGPU: 8,
    }),
    performance: Object.freeze({
        gpuTypeIds: Object.freeze([
            'NVIDIA B200',
            'NVIDIA H200',
            'NVIDIA H200 NVL',
            'NVIDIA H100 80GB HBM3',
            'NVIDIA H100 NVL',
        ]),
        containerDiskInGb: 160,
        minRAMPerGPU: 96,
        minVCPUPerGPU: 16,
    }),
});
const SESSION_GATEWAY = String.raw `set -eo pipefail
cinegen_model_root="$COMFY_MODEL_ROOT"
[ -n "$cinegen_model_root" ] || cinegen_model_root="/comfyui/models"
export COMFY_MODEL_ROOT="$cinegen_model_root"
cinegen_image_models="$CINEGEN_IMAGE_MODELS"
export CINEGEN_IMAGE_MODELS="$cinegen_image_models"
source /bootstrap_ltx25.sh

python - <<'PY' &
import base64
import binascii
import hashlib
import json
import mimetypes
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps

TOKEN = os.environ["CINEGEN_POD_TOKEN"]
COMFY = "http://127.0.0.1:8188"
COMFY_INPUT_ROOT = Path(os.environ.get("COMFY_INPUT_DIR", "/comfyui/input")).resolve()
COMFY_OUTPUT_ROOT = Path(os.environ.get("COMFY_OUTPUT_DIR", "/comfyui/output")).resolve()
MAX_BODY = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 14 * 1024 * 1024
MAX_ARTIFACT_BYTES = 100 * 1024 * 1024
ARTIFACT_CHUNK_BYTES = 1024 * 1024
ARTIFACT_TTL_SECONDS = 2 * 60 * 60
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
MODEL_ROOT = Path(os.environ.get("COMFY_MODEL_ROOT", "/comfyui/models")).resolve()
SELECTED_IMAGE_MODELS = tuple(
    model for model in os.environ.get("CINEGEN_IMAGE_MODELS", "").split(",")
    if model in {"sdxl", "qwen-image-edit"}
)
MODEL_FILES = {
    "sdxl": (MODEL_ROOT / "checkpoints" / "sd_xl_base_1.0.safetensors",),
    "qwen-image-edit": (
        MODEL_ROOT / "diffusion_models" / "qwen_image_edit_2511_int8_convrot.safetensors",
        MODEL_ROOT / "text_encoders" / "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        MODEL_ROOT / "vae" / "qwen_image_vae.safetensors",
        MODEL_ROOT / "loras" / "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    ),
}
ARTIFACT_ROOT = Path("/tmp/cinegen-ltx-artifacts").resolve()
jobs = {}
artifacts = {}
jobs_lock = threading.Lock()
render_lock = threading.Lock()
last_model_family = None
GPU_PROFILE = os.environ.get("CINEGEN_GPU_PROFILE", "balanced")

def gpu_memory_mib():
    try:
        value = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            text=True,
            timeout=5,
        ).splitlines()[0]
        return int(value.strip())
    except Exception:
        return 0

GPU_MEMORY_MIB = gpu_memory_mib()
# B200/H200-class sessions have enough headroom for ComfyUI to retain the
# recently used model and avoid a costly image -> LTX cold reload. H100 and
# lower-memory fallbacks keep the conservative unload behavior.
KEEP_MODELS_WARM = GPU_PROFILE == "performance" and GPU_MEMORY_MIB >= 120 * 1024

def port_ready(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False

def health_snapshot():
    installed_images = [
        model for model in SELECTED_IMAGE_MODELS
        if all(path.is_file() for path in MODEL_FILES[model])
    ]
    missing_images = [model for model in SELECTED_IMAGE_MODELS if model not in installed_images]
    comfy_ready = port_ready(8188)
    handler_ready = port_ready(8001)
    is_ready = comfy_ready and handler_ready and not missing_images
    installed = list(installed_images)
    if is_ready:
        installed.insert(0, "ltx-2.5")
        phase = "ready"
        message = "LTX-2.5 and the selected session models are ready."
    elif missing_images:
        phase = "downloading-image-models"
        message = "Downloading the selected image models."
    elif not comfy_ready:
        phase = "loading-ltx"
        message = "Downloading and loading LTX-2.5."
    else:
        phase = "verifying-models"
        message = "ComfyUI is verifying the required models and starting the session API."
    return {
        "ready": is_ready,
        "phase": phase,
        "message": message,
        "installedModels": installed,
        "missingModels": missing_images,
        "components": {
            "comfyui": "ready" if comfy_ready else "starting",
            "sessionApi": "ready" if handler_ready else "starting",
        },
    }

def requested_duration(body):
    try:
        payload = json.loads(body)
        requested = payload.get("input", {}).get("cinegen_duration_sec", 5)
        return max(1, min(20, int(round(float(requested)))))
    except (AttributeError, TypeError, ValueError, OverflowError, json.JSONDecodeError):
        return 5

def requested_task(body):
    try:
        payload = json.loads(body)
        task = payload.get("input", {}).get("cinegen_task", "ltx-2.5")
        return task if task in {"ltx-2.5", "sdxl", "qwen-image-edit"} else "ltx-2.5"
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return "ltx-2.5"

def json_request(url, payload=None, timeout=30):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "application/json", **({"Content-Type": "application/json"} if data else {})},
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw)
            message = provider_error(detail)
        except Exception:
            message = raw.decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or "ComfyUI rejected the request") from error
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as error:
        raise RuntimeError("ComfyUI returned an invalid response") from error
    if not isinstance(value, dict):
        raise RuntimeError("ComfyUI returned an invalid response")
    return value

def provider_error(payload):
    if not isinstance(payload, dict):
        return ""
    direct = payload.get("detail") or payload.get("message")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()[:1200]
    error = payload.get("error")
    if isinstance(error, str) and error.strip():
        return error.strip()[:1200]
    if isinstance(error, dict):
        message = error.get("message") or error.get("details")
        if isinstance(message, str) and message.strip():
            return message.strip()[:1200]
    node_errors = payload.get("node_errors")
    if isinstance(node_errors, dict):
        for node_error in node_errors.values():
            if not isinstance(node_error, dict):
                continue
            errors = node_error.get("errors")
            if not isinstance(errors, list):
                continue
            for item in errors:
                if not isinstance(item, dict):
                    continue
                message = item.get("message") or item.get("details")
                if isinstance(message, str) and message.strip():
                    return message.strip()[:1200]
    return ""

def safe_child(root, *parts):
    target = root.joinpath(*parts).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("The generated media path is invalid") from error
    return target

def remove_artifact_file(record):
    path = record.get("path") if isinstance(record, dict) else None
    if not isinstance(path, str):
        return
    try:
        Path(path).unlink()
    except OSError:
        pass

def cleanup_expired():
    cutoff = time.time() - ARTIFACT_TTL_SECONDS
    expired = []
    with jobs_lock:
        for artifact_id, artifact in list(artifacts.items()):
            created_at = artifact.get("created_at") if isinstance(artifact, dict) else None
            if not isinstance(created_at, (int, float)) or created_at >= cutoff:
                continue
            expired.append(artifacts.pop(artifact_id))
        for job_id, job in list(jobs.items()):
            finished_at = job.get("finished_at") if isinstance(job, dict) else None
            if isinstance(finished_at, (int, float)) and finished_at < cutoff:
                jobs.pop(job_id, None)
    for artifact in expired:
        remove_artifact_file(artifact)

def cleanup_loop():
    while True:
        time.sleep(300)
        cleanup_expired()

def store_artifact(job_id, source, media_type):
    size = source.stat().st_size
    if size <= 0 or size > MAX_ARTIFACT_BYTES:
        raise RuntimeError("The generated media is empty or larger than 100 MB")
    suffix = source.suffix.lower()
    if suffix not in MEDIA_EXTENSIONS:
        raise RuntimeError("The generated media format is unsupported")
    ARTIFACT_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = safe_child(ARTIFACT_ROOT, job_id + suffix)
    with jobs_lock:
        previous = artifacts.pop(job_id, None)
    remove_artifact_file(previous)
    try:
        destination.unlink()
    except FileNotFoundError:
        pass
    os.replace(source, destination)
    created_at = time.time()
    record = {
        "id": job_id,
        "path": str(destination),
        "byte_size": size,
        "media_type": media_type,
        "created_at": created_at,
    }
    with jobs_lock:
        artifacts[job_id] = record
    return {
        "id": job_id,
        "byteSize": size,
        "mediaType": media_type,
        "chunkSize": ARTIFACT_CHUNK_BYTES,
        "expiresAt": created_at + ARTIFACT_TTL_SECONDS,
    }

def replace_names(value, replacements):
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [replace_names(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: replace_names(item, replacements) for key, item in value.items()}
    return value

def decode_image(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("The reference image is empty")
    encoded = value.split(",", 1)[1] if "," in value and ";base64" in value.split(",", 1)[0] else value
    encoded = "".join(encoded.split())
    if not encoded or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4 + 8:
        raise ValueError("The reference image is larger than 14 MB")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The reference image is invalid") from error
    if not decoded or len(decoded) > MAX_IMAGE_BYTES:
        raise ValueError("The reference image is empty or too large")
    return decoded

def workflow_size(workflow):
    try:
        width = int(workflow.get("398:372", {}).get("inputs", {}).get("value", 1280))
        height = int(workflow.get("398:360", {}).get("inputs", {}).get("value", 720))
    except (AttributeError, TypeError, ValueError, OverflowError):
        width, height = 1280, 720
    return max(64, min(2048, width)), max(64, min(2048, height))

def canonical_png(value, target_size=None):
    try:
        image = Image.open(BytesIO(decode_image(value)))
        image.seek(0)
        image = ImageOps.exif_transpose(image)
        image.load()
    except Exception as error:
        raise ValueError("The reference image could not be decoded") from error
    if image.width <= 0 or image.height <= 0 or image.width * image.height > 64 * 1024 * 1024:
        raise ValueError("The reference image dimensions are invalid")
    if "A" in image.getbands():
        background = Image.new("RGB", image.size, (127, 127, 127))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")
    if target_size and (image.width <= 64 or image.height <= 64):
        image = image.resize(target_size, Image.Resampling.LANCZOS)
    elif image.width > 4096 or image.height > 4096:
        image.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue(), image.size

def prepare_workflow(body, job_id):
    payload = json.loads(body)
    job_input = payload.get("input") if isinstance(payload, dict) else None
    workflow = job_input.get("workflow") if isinstance(job_input, dict) else None
    images = job_input.get("images", []) if isinstance(job_input, dict) else []
    task = job_input.get("cinegen_task", "ltx-2.5") if isinstance(job_input, dict) else "ltx-2.5"
    if task not in {"ltx-2.5", "sdxl", "qwen-image-edit"}:
        raise ValueError("The generation task is invalid")
    if not isinstance(workflow, dict):
        raise ValueError("The generation workflow is missing")
    if not isinstance(images, list):
        raise ValueError("The reference image input is invalid")
    target_size = workflow_size(workflow) if task == "ltx-2.5" else None
    replacements = {}
    written = []
    for index, image in enumerate(images):
        if not isinstance(image, dict):
            raise ValueError("The reference image input is invalid")
        original = image.get("name")
        if not isinstance(original, str) or not original.strip():
            raise ValueError("The reference image name is invalid")
        relative = Path("cinegen") / job_id / (str(index) + ".png")
        target = safe_child(COMFY_INPUT_ROOT, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        encoded, _dimensions = canonical_png(image.get("image"), target_size)
        target.write_bytes(encoded)
        replacements[original] = relative.as_posix()
        written.append(target)
    workflow = replace_names(workflow, replacements)
    return workflow, written, task

def history_error(history):
    status = history.get("status") if isinstance(history, dict) else None
    messages = status.get("messages", []) if isinstance(status, dict) else []
    for entry in reversed(messages if isinstance(messages, list) else []):
        if not isinstance(entry, (list, tuple)) or len(entry) < 2 or not isinstance(entry[1], dict):
            continue
        kind, detail = str(entry[0]), entry[1]
        if kind != "execution_error":
            continue
        message = detail.get("exception_message") or detail.get("message") or detail.get("exception_type")
        node = detail.get("node_type") or detail.get("node_id")
        if isinstance(message, str) and message.strip():
            prefix = str(node).strip() + ": " if node else ""
            return (prefix + message.strip())[:1200]
    if isinstance(status, dict) and str(status.get("status_str", "")).lower() in {"error", "failed"}:
        return "ComfyUI could not complete the generation workflow"
    return ""

def wait_for_history(prompt_id):
    deadline = time.time() + 1800
    while time.time() < deadline:
        history = json_request(COMFY + "/history/" + prompt_id, timeout=15)
        entry = history.get(prompt_id)
        if isinstance(entry, dict):
            return entry
        time.sleep(1.5)
    raise TimeoutError("The generation did not finish within 30 minutes")

def output_entries(value, task, found=None):
    found = [] if found is None else found
    if isinstance(value, dict):
        filename = value.get("filename")
        if isinstance(filename, str) and filename.strip():
            media_type = value.get("media_type") or value.get("mime_type") or ""
            suffix = Path(filename).suffix.lower()
            is_video = suffix in VIDEO_EXTENSIONS or (isinstance(media_type, str) and media_type.startswith("video/"))
            is_image = suffix in IMAGE_EXTENSIONS or (isinstance(media_type, str) and media_type.startswith("image/"))
            if (task == "ltx-2.5" and is_video) or (task != "ltx-2.5" and is_image):
                found.append(value)
                return found
        for nested in value.values():
            output_entries(nested, task, found)
    elif isinstance(value, list):
        for nested in value:
            output_entries(nested, task, found)
    return found

def read_outputs(history, job_id, task):
    error = history_error(history)
    if error:
        raise RuntimeError(error)
    entries = output_entries(history.get("outputs", {}), task)
    seen = set()
    for entry in entries:
        filename = str(entry.get("filename", "")).strip()
        subfolder = str(entry.get("subfolder", "")).strip()
        key = (subfolder, filename)
        if not filename or key in seen:
            continue
        seen.add(key)
        if Path(filename).name != filename or Path(subfolder).is_absolute() or ".." in Path(subfolder).parts:
            raise ValueError("The generated media path is invalid")
        path = safe_child(COMFY_OUTPUT_ROOT, subfolder, filename)
        if not path.is_file():
            raise RuntimeError("ComfyUI finished, but its generated media file is missing")
        media_type = mimetypes.guess_type(filename)[0] or ("video/mp4" if task == "ltx-2.5" else "image/png")
        artifact = store_artifact(job_id, path, media_type)
        return {"status": "success", "output": {"artifact": artifact}}
    expected = "video" if task == "ltx-2.5" else "image"
    raise RuntimeError("ComfyUI completed the workflow without returning an " + expected)

def run_comfy_job(job_id, body):
    workflow, input_paths, task = prepare_workflow(body, job_id)
    try:
        submitted = json_request(COMFY + "/prompt", {"prompt": workflow}, timeout=30)
        prompt_id = submitted.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise RuntimeError(provider_error(submitted) or "ComfyUI did not return a render ID")
        return read_outputs(wait_for_history(prompt_id), job_id, task)
    finally:
        for path in input_paths:
            try:
                path.unlink()
            except OSError:
                pass

def run_job(job_id, body):
    global last_model_family
    duration_sec = requested_duration(body)
    task = requested_task(body)
    with render_lock:
        with jobs_lock:
            request_hash = jobs.get(job_id, {}).get("_request_hash")
            jobs[job_id] = {
                "id": job_id,
                "status": "IN_PROGRESS",
                "task": task,
                "_request_hash": request_hash,
            }
        try:
            if last_model_family and last_model_family != task and not KEEP_MODELS_WARM:
                try:
                    json_request(COMFY + "/free", {"unload_models": True, "free_memory": True}, timeout=30)
                except Exception:
                    pass
            last_model_family = task
            output = run_comfy_job(job_id, body)
            result = {
                "id": job_id,
                "status": "COMPLETED",
                "output": output,
                "durationSec": duration_sec,
                "task": task,
            }
        except Exception as error:
            result = {
                "id": job_id,
                "status": "FAILED",
                "error": str(error),
                "durationSec": duration_sec,
                "task": task,
            }
        result["finished_at"] = time.time()
        result["_request_hash"] = request_hash
        with jobs_lock:
            jobs[job_id] = result

def public_job(job):
    if not isinstance(job, dict):
        return job
    return {key: value for key, value in job.items() if not str(key).startswith("_")}

def artifact_chunk(artifact_id, query):
    with jobs_lock:
        artifact = artifacts.get(artifact_id)
    if not isinstance(artifact, dict):
        return 404, {"error": "Artifact not found or expired"}
    try:
        offset = int(query.get("offset", ["0"])[0])
        requested = int(query.get("length", [str(ARTIFACT_CHUNK_BYTES)])[0])
    except (TypeError, ValueError, OverflowError):
        return 400, {"error": "Artifact range is invalid"}
    size = int(artifact.get("byte_size", 0))
    if offset < 0 or offset >= size or requested <= 0 or requested > ARTIFACT_CHUNK_BYTES:
        return 416, {"error": "Artifact range is invalid"}
    length = min(requested, size - offset)
    try:
        with open(artifact["path"], "rb") as source:
            source.seek(offset)
            chunk = source.read(length)
    except (OSError, KeyError):
        with jobs_lock:
            stale = artifacts.pop(artifact_id, None)
        remove_artifact_file(stale)
        return 410, {"error": "Artifact is no longer available"}
    if len(chunk) != length:
        return 500, {"error": "Artifact could not be read completely"}
    return 200, {
        "id": artifact_id,
        "offset": offset,
        "byteSize": size,
        "mediaType": artifact.get("media_type") or "application/octet-stream",
        "data": base64.b64encode(chunk).decode("ascii"),
    }

def delete_artifact(artifact_id):
    with jobs_lock:
        artifact = artifacts.pop(artifact_id, None)
    remove_artifact_file(artifact)
    return artifact is not None

class Gateway(BaseHTTPRequestHandler):
    server_version = "CineGenLTX/1"

    def log_message(self, *_args):
        return

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def do_GET(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        cleanup_expired()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            snapshot = health_snapshot()
            self.send_json(200 if snapshot["ready"] else 503, {
                **snapshot,
                "apiVersion": 2,
                "selectedImageModels": list(SELECTED_IMAGE_MODELS),
                "capabilities": {
                    "asyncJobs": True,
                    "artifactChunks": True,
                    "imageArtifacts": True,
                    "idempotentSubmissions": True,
                    "maxArtifactChunkBytes": ARTIFACT_CHUNK_BYTES,
                },
            })
            return
        if parsed.path.startswith("/status/"):
            job_id = parsed.path.split("/", 2)[-1]
            with jobs_lock:
                job = jobs.get(job_id)
            self.send_json(200 if job else 404, public_job(job) if job else {"error": "Job not found"})
            return
        if parsed.path.startswith("/artifact/"):
            artifact_id = parsed.path.split("/", 2)[-1]
            status, payload = artifact_chunk(artifact_id, urllib.parse.parse_qs(parsed.query))
            self.send_json(status, payload)
            return
        self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/artifact/"):
            self.send_json(404, {"error": "Not found"})
            return
        artifact_id = parsed.path.split("/", 2)[-1]
        delete_artifact(artifact_id)
        self.send_json(200, {"ok": True})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        if self.path != "/run":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "Generation request is too large"})
            return
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except Exception:
            self.send_json(400, {"error": "Invalid JSON"})
            return
        job_input = payload.get("input") if isinstance(payload, dict) else None
        requested_job_id = job_input.get("cinegen_job_id") if isinstance(job_input, dict) else None
        if requested_job_id is not None and (
            not isinstance(requested_job_id, str)
            or len(requested_job_id) != 32
            or any(character not in "0123456789abcdef" for character in requested_job_id)
        ):
            self.send_json(422, {"error": "The generation job ID is invalid"})
            return
        job_id = requested_job_id or uuid.uuid4().hex
        request_hash = hashlib.sha256(body).hexdigest()
        created = False
        with jobs_lock:
            existing = jobs.get(job_id)
            if existing is None:
                existing = {
                    "id": job_id,
                    "status": "IN_QUEUE",
                    "task": requested_task(body),
                    "_request_hash": request_hash,
                }
                jobs[job_id] = existing
                created = True
            elif existing.get("_request_hash") != request_hash:
                existing = None
        if existing is None:
            self.send_json(409, {"error": "The generation job ID was already used for different input"})
            return
        if created:
            threading.Thread(target=run_job, args=(job_id, body), daemon=True).start()
        self.send_json(202, public_job(existing))

threading.Thread(target=cleanup_loop, daemon=True).start()
ThreadingHTTPServer(("0.0.0.0", 8000), Gateway).serve_forever()
PY

# Bring the authenticated health gateway up before downloading optional image
# models. Future Pods can now report useful startup progress while those large
# files are still being fetched.
cinegen_hf_token="$(ltx_hf_token)"
case ",$CINEGEN_IMAGE_MODELS," in
    *,sdxl,*)
        ltx_download \
            "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors" \
            "$cinegen_model_root/checkpoints/sd_xl_base_1.0.safetensors" \
            "$cinegen_hf_token"
        ;;
esac
case ",$CINEGEN_IMAGE_MODELS," in
    *,qwen-image-edit,*)
        ltx_download \
            "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors" \
            "$cinegen_model_root/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors" \
            "$cinegen_hf_token"
        ltx_download \
            "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" \
            "$cinegen_model_root/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" \
            "$cinegen_hf_token"
        ltx_download \
            "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors" \
            "$cinegen_model_root/vae/qwen_image_vae.safetensors" \
            "$cinegen_hf_token"
        ltx_download \
            "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" \
            "$cinegen_model_root/loras/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" \
            "$cinegen_hf_token"
        ;;
esac

sed 's/--rp_api_host=0.0.0.0/--rp_api_host=127.0.0.1 --rp_api_port=8001/' /start.sh > /tmp/cinegen-ltx-start.sh
chmod +x /tmp/cinegen-ltx-start.sh
exec /tmp/cinegen-ltx-start.sh`;
export class RunpodLtx25Error extends Error {
    code;
    statusCode;
    constructor(message, code = 'RUNPOD_LTX_ERROR', statusCode = 502) {
        super(message);
        this.name = 'RunpodLtx25Error';
        this.code = code;
        this.statusCode = statusCode;
    }
}
class RunpodRequestTimeoutError extends Error {
    timeoutMs;
    constructor(timeoutMs) {
        super(`The provider did not respond within ${timeoutMs} ms.`);
        this.name = 'RunpodRequestTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}
function required(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new RunpodLtx25Error(`${label} is required.`, 'MISSING_CONFIGURATION', 422);
    }
    return value.trim();
}
function safeId(value, label) {
    const id = required(value, label);
    if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)) {
        throw new RunpodLtx25Error(`${label} is invalid.`, 'INVALID_CONFIGURATION', 422);
    }
    return id;
}
async function readResponse(res) {
    const text = await res.text();
    if (!text)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
async function responseWithDeadline(fetchImpl, url, init = {}, timeoutMs = RUNPOD_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const upstreamSignal = init.signal;
    const forwardAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted)
        forwardAbort();
    else
        upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });
    let timer;
    const timeoutError = new RunpodRequestTimeoutError(timeoutMs);
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort(timeoutError);
            reject(timeoutError);
        }, timeoutMs);
    });
    const operation = (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        const payload = await readResponse(response);
        return { response, payload };
    })();
    try {
        return await Promise.race([operation, deadline]);
    }
    finally {
        clearTimeout(timer);
        upstreamSignal?.removeEventListener('abort', forwardAbort);
    }
}
function requestTimeoutForUrl(url) {
    try {
        return new URL(url).pathname === '/health' ? POD_HEALTH_TIMEOUT_MS : RUNPOD_REQUEST_TIMEOUT_MS;
    }
    catch {
        return RUNPOD_REQUEST_TIMEOUT_MS;
    }
}
function providerMessage(payload, fallback) {
    if (payload && typeof payload === 'object') {
        const record = payload;
        const direct = record.error ?? record.message ?? record.detail;
        if (typeof direct === 'string' && direct.trim())
            return direct.slice(0, 800);
        if (Array.isArray(record.errors) && record.errors.length) {
            return JSON.stringify(record.errors).slice(0, 800);
        }
    }
    return fallback;
}
async function request(fetchImpl, url, init, fallback, accepted = [200, 201, 202, 204], timeoutMs = requestTimeoutForUrl(url)) {
    let exchange;
    try {
        exchange = await responseWithDeadline(fetchImpl, url, init, timeoutMs);
    }
    catch (error) {
        if (error instanceof RunpodRequestTimeoutError) {
            throw new RunpodLtx25Error(`${fallback} RunPod did not respond before the request timed out.`, 'PROVIDER_TIMEOUT', 504);
        }
        throw new RunpodLtx25Error(error instanceof Error ? error.message : fallback, 'PROVIDER_UNREACHABLE', 502);
    }
    const { response: res, payload } = exchange;
    if (!accepted.includes(res.status)) {
        throw new RunpodLtx25Error(providerMessage(payload, `${fallback} (${res.status})`), 'PROVIDER_ERROR', res.status);
    }
    return payload;
}
function runpodHeaders(runpodKey, json = false) {
    return {
        Authorization: `Bearer ${runpodKey}`,
        Accept: 'application/json',
        ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
}

function podLogLines(raw) {
    const lines = [];
    for (const frame of raw.split(/\r?\n\r?\n/)) {
        const data = frame.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
            .join('\n');
        if (!data)
            continue;
        try {
            const payload = JSON.parse(data);
            if (typeof payload?.line === 'string')
                lines.push(payload.line);
            else
                lines.push(data);
        }
        catch {
            lines.push(data);
        }
    }
    return lines;
}

async function readPodLogSnapshot(fetchImpl, runpodKey, podId) {
    const controller = new AbortController();
    const overall = setTimeout(() => controller.abort(), POD_LOG_MAX_WAIT_MS);
    let reader;
    try {
        const endpoint = new URL(`${RUNPOD_REST_V2_URL}/pods/${encodeURIComponent(podId)}/logs`);
        endpoint.searchParams.set('tail', '200');
        const response = await fetchImpl(endpoint.toString(), {
            headers: {
                Authorization: `Bearer ${runpodKey}`,
                Accept: 'text/event-stream',
            },
            signal: controller.signal,
        });
        if (!response.ok || !response.body?.getReader)
            return [];
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let raw = '';
        // RunPod can send the SSE headers before it replays any log lines. Let
        // the overall abort deadline govern the first read; the short quiet
        // window is only useful after at least one chunk has arrived.
        let next = await reader.read();
        while (!next.done && raw.length < POD_LOG_MAX_BYTES) {
            raw += decoder.decode(next.value, { stream: true });
            if (raw.length >= POD_LOG_MAX_BYTES)
                break;
            let quietTimer;
            const quiet = new Promise((resolve) => {
                quietTimer = setTimeout(() => resolve({ quiet: true }), POD_LOG_QUIET_MS);
            });
            next = await Promise.race([reader.read(), quiet]);
            clearTimeout(quietTimer);
            if (next?.quiet)
                break;
        }
        raw += decoder.decode();
        return podLogLines(raw.slice(0, POD_LOG_MAX_BYTES));
    }
    catch {
        // Logs are diagnostic. A missing or slow log stream must not turn an
        // otherwise healthy model download into a startup failure.
        return [];
    }
    finally {
        clearTimeout(overall);
        controller.abort();
        if (reader) {
            try {
                await reader.cancel();
            }
            catch {
                // The abort can close the stream before cancel runs.
            }
            try {
                reader.releaseLock();
            }
            catch {
                // Ignore an already released stream.
            }
        }
    }
}

function fatalPodStartupFailure(lines) {
    const fatalPatterns = [
        /\b(?:errimagepull|imagepullbackoff)\b/i,
        /\bpull access denied\b/i,
        /\bfailed to get hub registry auth\b/i,
        /\bno such image:\s*\S+/i,
        /\bmanifest unknown\b/i,
        /\bno matching manifest\b/i,
        /\brepository\b.{0,180}\b(?:does not exist|not found)\b/i,
        /\bfailed to authorize\b/i,
        /\b(?:unauthorized|authentication required|no basic auth credentials)\b.{0,180}\b(?:image|registry|repository|manifest)\b/i,
        /\b(?:image|registry|repository|manifest)\b.{0,180}\b(?:unauthorized|authentication required|access denied)\b/i,
        /\b(?:failed|unable) to (?:pull|resolve) (?:image|reference)\b/i,
        /\bpull rate limit\b/i,
        /\boci runtime create failed\b/i,
        /\bfailed to (?:create|start) container\b/i,
        /\berror creating container\b/i,
        /\bcontainer (?:create|start) failed\b/i,
        /\bexec format error\b/i,
        /\bexec\b.{0,180}\b(?:no such file or directory|permission denied)\b/i,
    ];
    return lines.some((line) => fatalPatterns.some((pattern) => pattern.test(line)));
}
const APPLICATION_STARTUP_FAILURES = Object.freeze([
    Object.freeze({
        kind: 'huggingface-access',
        patterns: Object.freeze([
            /\bgatedrepoerror\b/i,
            /\b(?:cannot|could not|unable to) access (?:the )?gated (?:repo|repository)\b/i,
            /\b(?:401|403)(?: client error)?\b.{0,240}\bhuggingface\.co\b/i,
            /\bhuggingface\.co\b.{0,240}\b(?:401|403|unauthorized|forbidden|access denied)\b/i,
            /\binvalid user token\b/i,
            /\baccess to (?:this )?(?:model|repository) is restricted\b/i,
        ]),
        message: 'Hugging Face rejected a required model download. Check the read token and accept the model terms. The Pod is still running and billing until you end the session.',
    }),
    Object.freeze({
        kind: 'disk-full',
        patterns: Object.freeze([/\bno space left on device\b/i, /\[errno 28\]/i]),
        message: 'The Pod ran out of temporary disk while downloading the models. End this session, then start a new one with more container disk. The Pod is still billing until you end it.',
    }),
    Object.freeze({
        kind: 'gpu-memory',
        patterns: Object.freeze([
            /\bcuda out of memory\b/i,
            /\btorch\.outofmemoryerror\b/i,
            /\boutofmemoryerror\b/i,
            /\b(?:oom[- ]kill|killed process)\b/i,
            /\b(?:exit(?:ed)?(?: with)?(?: code)?|status)\s*137\b/i,
        ]),
        message: 'The selected GPU ran out of memory while loading the session models. End this session and choose a higher-memory GPU. The Pod is still billing until you end it.',
    }),
    Object.freeze({
        kind: 'cuda-startup',
        patterns: Object.freeze([
            /\bgpu is not available\.? pytorch cuda init failed\b/i,
            /\bcuda (?:initialization|driver initialization) (?:error|failed)\b/i,
            /\bno cuda gpus? (?:are )?available\b/i,
            /\bcuda driver version is insufficient\b/i,
        ]),
        message: 'RunPod could not initialize the GPU for this session. End the session and try another GPU. The Pod is still billing until you end it.',
    }),
    Object.freeze({
        kind: 'comfy-startup',
        patterns: Object.freeze([
            /\bcomfyui model discovery failed after\b/i,
            /\bcomfyui\b.{0,180}\b(?:failed to start|startup failed|exited unexpectedly|crashed)\b/i,
            /\b(?:failed|unable) to connect to comfyui\b/i,
            /\bconnection refused\b.{0,120}\b8188\b/i,
            /\bredis failed to (?:start|pass (?:its )?readiness check)\b/i,
        ]),
        message: 'ComfyUI could not finish starting or discover the required models. The Pod was kept so you can inspect it; it is still billing until you end the session.',
    }),
    Object.freeze({
        kind: 'session-api-startup',
        patterns: Object.freeze([
            /\b(?:handler|session api)\b.{0,180}\b(?:failed to start|startup failed|exited unexpectedly|crashed)\b/i,
            /\bunrecognized arguments:\b.{0,180}\b--rp_api_port\b/i,
            /\b(?:address already in use|errno 98)\b/i,
        ]),
        message: 'The session API could not finish starting. The Pod was kept so you can inspect it; it is still billing until you end the session.',
    }),
]);
function applicationPodStartupFailure(lines) {
    for (const failure of APPLICATION_STARTUP_FAILURES) {
        if (lines.some((line) => failure.patterns.some((pattern) => pattern.test(line))))
            return failure;
    }
    return undefined;
}
function imageModelNames(values) {
    if (!Array.isArray(values))
        return [];
    const names = [];
    for (const value of values) {
        const name = value === 'sdxl' ? 'SDXL' : value === 'qwen-image-edit' ? 'Qwen Image Edit' : undefined;
        if (name && !names.includes(name))
            names.push(name);
    }
    return names;
}
function healthStartupProgress(payload) {
    if (!payload || typeof payload !== 'object')
        return undefined;
    const phase = typeof payload.phase === 'string' ? payload.phase : '';
    if (phase === 'downloading-image-models') {
        const names = imageModelNames(payload.missingModels);
        return names.length
            ? `Downloading ${names.join(' and ')} for this temporary session…`
            : 'Downloading the selected image models for this temporary session…';
    }
    if (phase === 'loading-ltx' || phase === 'downloading')
        return 'Downloading and loading LTX-2.5 into the GPU…';
    if (phase === 'verifying-models')
        return 'ComfyUI is verifying the models and starting the session API…';
    if (phase === 'starting-comfyui')
        return 'Starting ComfyUI and discovering the session models…';
    return undefined;
}
function logStartupProgress(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (/\b(?:still fetching|pulling|downloading) (?:the )?(?:container )?image\b/i.test(line))
            return 'RunPod is downloading the CineGen container image…';
        if (/\b(?:qwen(?:_image)?|sd[_ -]?xl)\b/i.test(line) && /\b(?:download|fetch)\w*\b/i.test(line))
            return 'Downloading the selected image models for this temporary session…';
        if (/\b(?:model discovery|discovering|required models|verif\w* models?)\b/i.test(line))
            return 'ComfyUI is verifying the required models…';
        if (/\bcomfyui\b/i.test(line) && /\b(?:start|launch|initializ)\w*\b/i.test(line))
            return 'Starting ComfyUI…';
        if (/\b(?:cuda kernels?|loading (?:the )?(?:model|text encoder).*(?:gpu|cuda))\b/i.test(line))
            return 'Loading the models into the GPU…';
        if (/\b(?:download|fetch)\w*\b/i.test(line) && /\b(?:ltx|weights?|checkpoint|model)\b/i.test(line))
            return 'Downloading LTX-2.5 model files…';
    }
    return undefined;
}
async function createSecret(fetchImpl, runpodKey, name, value) {
    const query = `mutation { secretCreate(input: { name: ${JSON.stringify(name)}, value: ${JSON.stringify(value)}, description: "Temporary CineGen LTX-2.5 session credential" }) { id name } }`;
    const endpoint = new URL(RUNPOD_GRAPHQL_URL);
    endpoint.searchParams.set('api_key', runpodKey);
    const payload = await request(fetchImpl, endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query }),
    }, 'RunPod could not create the encrypted session secret.');
    const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
    const data = payload?.data;
    const created = data?.secretCreate;
    if (errors.length || typeof created?.id !== 'string') {
        throw new RunpodLtx25Error(providerMessage(payload, 'RunPod could not create the encrypted session secret.'));
    }
    return created.id;
}
async function deleteSecret(fetchImpl, runpodKey, secretId) {
    const query = `mutation { secretDelete(id: ${JSON.stringify(secretId)}) }`;
    const endpoint = new URL(RUNPOD_GRAPHQL_URL);
    endpoint.searchParams.set('api_key', runpodKey);
    await request(fetchImpl, endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query }),
    }, 'RunPod could not remove a temporary session secret.');
}
function podUrl(podId) {
    return `https://${podId}-${POD_PORT}.proxy.runpod.net`;
}
function validatePodUrl(value, podIdValue) {
    const podId = safeId(podIdValue, 'RunPod session ID');
    const url = new URL(required(value, 'RunPod session URL'));
    if (url.protocol !== 'https:'
        || url.username
        || url.password
        || url.hostname !== `${podId}-${POD_PORT}.proxy.runpod.net`) {
        throw new RunpodLtx25Error('RunPod session URL is invalid.', 'INVALID_CONFIGURATION', 422);
    }
    return { podId, url: `${url.origin}` };
}
function randomSuffix() {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
function normalizePod(payload) {
    const pod = payload && typeof payload === 'object' ? payload : {};
    const gpuRecord = pod.gpu && typeof pod.gpu === 'object' ? pod.gpu : undefined;
    const cost = Number(pod.adjustedCostPerHr ?? pod.costPerHr);
    return {
        id: typeof pod.id === 'string' ? pod.id : '',
        costPerHr: Number.isFinite(cost) ? cost : null,
        gpu: typeof gpuRecord?.displayName === 'string'
            ? gpuRecord.displayName
            : typeof gpuRecord?.id === 'string' ? gpuRecord.id : null,
        desiredStatus: typeof pod.desiredStatus === 'string' ? pod.desiredStatus : 'UNKNOWN',
    };
}
function gpuProfile(value) {
    const name = value === undefined ? DEFAULT_LTX25_GPU_PROFILE : value;
    if (typeof name !== 'string' || !Object.hasOwn(LTX25_GPU_PROFILES, name)) {
        throw new RunpodLtx25Error('Choose a valid LTX-2.5 GPU profile: economy, balanced, or performance.', 'INVALID_GPU_PROFILE', 422);
    }
    return { name, config: LTX25_GPU_PROFILES[name] };
}
function normalizeImageModels(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        throw new RunpodLtx25Error('Image models must be an array.', 'INVALID_IMAGE_MODELS', 422);
    }
    const models = [];
    for (const model of value) {
        if (typeof model !== 'string' || !IMAGE_MODEL_IDS.includes(model)) {
            throw new RunpodLtx25Error('Choose only supported session image models: SDXL or Qwen Image Edit.', 'INVALID_IMAGE_MODELS', 422);
        }
        if (!models.includes(model))
            models.push(model);
    }
    return models;
}
function sessionContainerDisk(profile, imageModels) {
    if (imageModels.includes('qwen-image-edit'))
        return Math.max(profile.containerDiskInGb, 200);
    if (imageModels.includes('sdxl'))
        return Math.max(profile.containerDiskInGb, 160);
    return profile.containerDiskInGb;
}
export async function setupRunpodLtx25(params, fetchImpl = fetch) {
    const runpodKey = required(params.runpodKey, 'RunPod API key');
    const huggingFaceToken = required(params.huggingFaceToken, 'Hugging Face read token');
    if (!/^hf_[A-Za-z0-9]+$/.test(huggingFaceToken)) {
        throw new RunpodLtx25Error('Enter a valid Hugging Face read token.', 'INVALID_HUGGINGFACE_TOKEN', 422);
    }
    const selectedGpuProfile = gpuProfile(params.gpuProfile);
    const imageModels = normalizeImageModels(params.imageModels);
    const suffix = randomSuffix();
    const hfSecretName = `cinegen_ltx25_hf_${suffix}`;
    const authSecretName = `cinegen_ltx25_session_${suffix}`;
    const podAuthToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    const secretIds = [];
    try {
        secretIds.push(await createSecret(fetchImpl, runpodKey, hfSecretName, huggingFaceToken));
        secretIds.push(await createSecret(fetchImpl, runpodKey, authSecretName, podAuthToken));
        const payload = await request(fetchImpl, `${RUNPOD_REST_URL}/pods`, {
            method: 'POST',
            headers: runpodHeaders(runpodKey, true),
            body: JSON.stringify({
                name: `CineGen LTX-2.5 Session ${suffix}`,
                cloudType: 'SECURE',
                computeType: 'GPU',
                imageName: LTX25_WORKER_IMAGE,
                gpuTypeIds: [...selectedGpuProfile.config.gpuTypeIds],
                gpuTypePriority: 'custom',
                gpuCount: 1,
                allowedCudaVersions: ['13.0'],
                containerDiskInGb: sessionContainerDisk(selectedGpuProfile.config, imageModels),
                volumeInGb: 0,
                ports: [`${POD_PORT}/http`],
                supportPublicIp: true,
                interruptible: false,
                minRAMPerGPU: selectedGpuProfile.config.minRAMPerGPU,
                minVCPUPerGPU: selectedGpuProfile.config.minVCPUPerGPU,
                dockerEntrypoint: [],
                dockerStartCmd: ['bash', '-lc', SESSION_GATEWAY],
                env: {
                    RUN_MODE: 'local-api',
                    PERSIST_WORKSPACE: 'false',
                    LTX_FRONTEND_ENABLED: 'false',
                    COMFY_LOG_LEVEL: 'INFO',
                    LTX25_PRELOAD_VARIANT: 'distilled-int8',
                    LTX25_PRELOAD_PROMPT_ENHANCER: 'true',
                    CINEGEN_IMAGE_MODELS: imageModels.join(','),
                    CINEGEN_GPU_PROFILE: selectedGpuProfile.name,
                    HUGGINGFACE_ACCESS_TOKEN: `{{ RUNPOD_SECRET_${hfSecretName} }}`,
                    CINEGEN_POD_TOKEN: `{{ RUNPOD_SECRET_${authSecretName} }}`,
                },
            }),
        }, 'RunPod could not create the LTX-2.5 session Pod.');
        const pod = normalizePod(payload);
        if (!pod.id)
            throw new RunpodLtx25Error('RunPod created a Pod without returning its ID.');
        return {
            podId: pod.id,
            podUrl: podUrl(pod.id),
            podAuthToken,
            secretIds,
            status: 'downloading',
            phase: 'downloading',
            message: 'RunPod is downloading and loading LTX-2.5. The first session can take a while.',
            gpuProfile: selectedGpuProfile.name,
            imageModels,
            costPerHr: pod.costPerHr,
            gpu: pod.gpu,
        };
    }
    catch (error) {
        await Promise.allSettled(secretIds.map((secretId) => deleteSecret(fetchImpl, runpodKey, secretId)));
        throw error;
    }
}
export async function getRunpodLtx25Status(params, fetchImpl = fetch) {
    const runpodKey = required(params.runpodKey, 'RunPod API key');
    const podAuthToken = required(params.podAuthToken, 'RunPod session token');
    const target = validatePodUrl(params.podUrl, params.podId);
    let podPayload;
    try {
        podPayload = await request(fetchImpl, `${RUNPOD_REST_URL}/pods/${target.podId}`, {
            headers: runpodHeaders(runpodKey),
        }, 'RunPod could not read the LTX-2.5 session.');
    }
    catch (error) {
        if (error instanceof RunpodLtx25Error && error.statusCode === 404) {
            return {
                status: 'ended', phase: 'ended', podId: target.podId, podUrl: target.url,
                message: 'This LTX-2.5 session has ended.', costPerHr: null, gpu: null,
            };
        }
        throw error;
    }
    const pod = normalizePod(podPayload);
    let healthObservation;
    if (pod.desiredStatus === 'RUNNING') {
        try {
            const { response: health, payload: body } = await responseWithDeadline(fetchImpl, `${target.url}/health`, {
                headers: { Authorization: `Bearer ${podAuthToken}`, Accept: 'application/json' },
            }, POD_HEALTH_TIMEOUT_MS);
            if (health.status === 401 || health.status === 403) {
                return {
                    status: 'error', phase: 'error', podId: target.podId, podUrl: target.url,
                    message: 'CineGen could not authenticate with this Pod. End the session and start a new one. The current Pod keeps billing until you end it.',
                    costPerHr: pod.costPerHr, gpu: pod.gpu,
                };
            }
            if (health.ok && body?.ready === true) {
                if (!supportsReliableArtifactTransfer(body)) {
                    return {
                        status: 'error', phase: 'error', podId: target.podId, podUrl: target.url,
                        message: 'This Pod is running, but it was started before CineGen\'s reliable video-transfer update. End this session when you are ready, then start a new LTX-2.5 session. The current Pod keeps billing until you end it.',
                        costPerHr: pod.costPerHr, gpu: pod.gpu,
                    };
                }
                return {
                    status: 'ready', phase: 'ready', podId: target.podId, podUrl: target.url,
                    message: 'LTX-2.5 is loaded and ready to generate.', costPerHr: pod.costPerHr, gpu: pod.gpu,
                };
            }
            healthObservation = { kind: 'response', status: health.status, body };
        }
        catch (error) {
            healthObservation = error instanceof RunpodRequestTimeoutError
                ? { kind: 'timeout' }
                : { kind: 'unreachable' };
        }
    }
    const logLines = await readPodLogSnapshot(fetchImpl, runpodKey, target.podId);
    const applicationFailure = applicationPodStartupFailure(logLines);
    if (!applicationFailure && fatalPodStartupFailure(logLines)) {
        try {
            const cleanup = await terminateRunpodLtx25({
                runpodKey,
                podId: target.podId,
                secretIds: params.secretIds,
            }, fetchImpl);
            return {
                status: 'error', phase: 'startup-failed-cleaned', podId: target.podId, podUrl: target.url,
                message: cleanup.warning
                    ? 'The LTX-2.5 container could not start. CineGen deleted the failed Pod and billing stopped, but RunPod could not remove one temporary secret. Check RunPod Secrets.'
                    : 'The LTX-2.5 container could not start. CineGen deleted the failed Pod and temporary secrets; billing stopped.',
                costPerHr: null, gpu: pod.gpu,
            };
        }
        catch {
            return {
                status: 'error', phase: 'startup-failed-cleanup-required', podId: target.podId, podUrl: target.url,
                message: 'The LTX-2.5 container could not start, and CineGen could not confirm cleanup. Delete this Pod in RunPod now to stop billing.',
                costPerHr: pod.costPerHr, gpu: pod.gpu,
            };
        }
    }
    if (applicationFailure) {
        return {
            status: 'error', phase: 'error', podId: target.podId, podUrl: target.url,
            message: applicationFailure.message,
            startupFailure: applicationFailure.kind,
            costPerHr: pod.costPerHr, gpu: pod.gpu,
        };
    }
    if (pod.desiredStatus !== 'RUNNING') {
        return {
            status: 'error', phase: 'error', podId: target.podId, podUrl: target.url,
            message: `RunPod reports the session as ${pod.desiredStatus.toLowerCase()}.`,
            costPerHr: pod.costPerHr, gpu: pod.gpu,
        };
    }
    let message;
    if (healthObservation?.kind === 'timeout') {
        message = 'RunPod reports the Pod is running, but its private gateway did not answer within 7 seconds. It may still be starting; check again shortly. Billing continues while the Pod runs.';
    }
    else if (healthObservation?.kind === 'response'
        && (healthObservation.status === 502 || healthObservation.status === 504)) {
        message = `RunPod reports the Pod is running, but its private gateway returned ${healthObservation.status}. The container may still be starting; check again shortly. Billing continues while the Pod runs.`;
    }
    else {
        message = healthStartupProgress(healthObservation?.body) ?? logStartupProgress(logLines);
    }
    if (!message && healthObservation?.kind === 'unreachable') {
        message = 'RunPod reports the Pod is running, but its private gateway is not reachable yet. The container may still be starting; check again shortly. Billing continues while the Pod runs.';
    }
    else if (!message && healthObservation?.kind === 'response' && healthObservation.status >= 400) {
        message = `RunPod reports the Pod is running, but its private gateway returned HTTP ${healthObservation.status}. Check again shortly. Billing continues while the Pod runs.`;
    }
    return {
        status: 'downloading', phase: 'downloading', podId: target.podId, podUrl: target.url,
        message: message ?? 'Downloading weights and loading LTX-2.5 into the GPU…', costPerHr: pod.costPerHr, gpu: pod.gpu,
    };
}
export async function terminateRunpodLtx25(params, fetchImpl = fetch) {
    const runpodKey = required(params.runpodKey, 'RunPod API key');
    const podId = safeId(params.podId, 'RunPod session ID');
    await request(fetchImpl, `${RUNPOD_REST_URL}/pods/${podId}`, {
        method: 'DELETE', headers: runpodHeaders(runpodKey),
    }, 'RunPod could not end the LTX-2.5 session.', [200, 204, 404]);
    const secretIds = Array.isArray(params.secretIds)
        ? params.secretIds.filter((value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))
        : [];
    const cleanup = await Promise.allSettled(secretIds.map((secretId) => deleteSecret(fetchImpl, runpodKey, secretId)));
    const failed = cleanup.filter((result) => result.status === 'rejected').length;
    return failed
        ? { ok: true, warning: 'The Pod was deleted and billing stopped, but one temporary RunPod secret could not be removed.' }
        : { ok: true };
}
function dimensions(aspectRatio, resolution) {
    if (aspectRatio === '9:16')
        return resolution === '1080p' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    if (aspectRatio === '1:1')
        return resolution === '1080p' ? { width: 1080, height: 1080 } : { width: 1024, height: 1024 };
    return resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}
function referenceDataImages(input) {
    return Array.isArray(input.referenceImages)
        ? input.referenceImages.filter((value) => typeof value === 'string' && value.trim())
        : [];
}
function buildWorkflow(input) {
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));
    const prompt = required(input.prompt, 'Video prompt');
    if (prompt.length > MAX_PROMPT_CHARS) {
        throw new RunpodLtx25Error('The LTX-2.5 video prompt is too long.', 'PROMPT_TOO_LONG', 422);
    }
    const durationSec = Math.min(20, Math.max(1, Math.round(Number(input.durationSec) || 5)));
    const aspectRatio = ['16:9', '9:16', '1:1'].includes(input.aspectRatio ?? '') ? input.aspectRatio : '16:9';
    const resolution = input.resolution === '1080p' ? '1080p' : '720p';
    const size = dimensions(aspectRatio, resolution);
    workflow['398:376'].inputs.value = prompt;
    workflow['395'].inputs.image = 'cinegen-source.png';
    workflow['398:362'].inputs.value = durationSec;
    workflow['398:372'].inputs.value = size.width;
    workflow['398:360'].inputs.value = size.height;
    workflow['398:361'].inputs.value = 24;
    workflow['398:380'].inputs.sampling_mode = 'on';
    workflow['398:380'].inputs['sampling_mode.seed'] = Math.floor(Math.random() * 999_999_998) + 1;
    workflow['398:383'].inputs.value = input.generateAudio !== false;
    workflow['398:363'].inputs.value = referenceDataImages(input).length === 0;
    workflow['398:338'].inputs.noise_seed = Math.floor(Math.random() * 999_999_999_999_998) + 1;
    workflow['398:339'].inputs.noise_seed = Math.floor(Math.random() * 999_999_999_999_998) + 1;
    return workflow;
}
function imageData(input) {
    const references = referenceDataImages(input);
    const candidate = references.find((value) => value.startsWith('data:image/')) ?? (references.length ? '' : DEFAULT_FRAME);
    const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(candidate);
    if (!match || !match[2] || match[2].length % 4 === 1) {
        throw new RunpodLtx25Error('The LTX-2.5 reference image could not be prepared.', 'INVALID_REFERENCE', 422);
    }
    const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
    const estimatedBytes = Math.floor(match[2].length * 0.75) - padding;
    if (estimatedBytes > MAX_REFERENCE_BYTES) {
        throw new RunpodLtx25Error('The first LTX-2.5 reference image is larger than 14 MB.', 'REFERENCE_TOO_LARGE', 413);
    }
    return candidate;
}
function imageJobModel(value) {
    if (typeof value !== 'string' || !IMAGE_MODEL_IDS.includes(value)) {
        throw new RunpodLtx25Error('Choose SDXL or Qwen Image Edit for this image job.', 'INVALID_IMAGE_MODEL', 422);
    }
    return value;
}
function optionalImageJobModel(value) {
    try {
        return imageJobModel(value);
    }
    catch {
        return undefined;
    }
}
function imageModelLabel(model) {
    return model === 'sdxl' ? 'SDXL' : 'Qwen Image Edit 2511';
}
function imageDimension(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    const dimension = Number(value);
    if (!Number.isInteger(dimension) || dimension < 256 || dimension > 2048) {
        throw new RunpodLtx25Error('Image width and height must be whole pixels from 256 to 2048.', 'INVALID_DIMENSIONS', 422);
    }
    return Math.max(256, Math.min(2048, Math.round(dimension / 16) * 16));
}
function imageSeed(value) {
    if (value === undefined || value === null)
        return Math.floor(Math.random() * 999_999_999_999_998) + 1;
    const seed = Number(value);
    if (!Number.isSafeInteger(seed) || seed < 0) {
        throw new RunpodLtx25Error('Image seed must be a non-negative whole number.', 'INVALID_SEED', 422);
    }
    return seed;
}
function imageReferenceData(value, index) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
        typeof value === 'string' ? value.trim() : '',
    );
    if (!match || !match[2] || match[2].length % 4 === 1) {
        throw new RunpodLtx25Error(`Qwen reference image ${index + 1} could not be prepared.`, 'INVALID_REFERENCE', 422);
    }
    const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
    const estimatedBytes = Math.floor(match[2].length * 0.75) - padding;
    if (estimatedBytes > MAX_REFERENCE_BYTES) {
        throw new RunpodLtx25Error(`Qwen reference image ${index + 1} is larger than 14 MB.`, 'REFERENCE_TOO_LARGE', 413);
    }
    return value.trim();
}
function imageReferences(input, model) {
    const references = Array.isArray(input.referenceImages)
        ? input.referenceImages.filter((value) => typeof value === 'string' && value.trim())
        : [];
    if (model === 'sdxl' && references.length) {
        throw new RunpodLtx25Error('SDXL session jobs are text-to-image and do not accept reference images.', 'INVALID_REFERENCE', 422);
    }
    if (model === 'qwen-image-edit' && (references.length < 1 || references.length > 3)) {
        throw new RunpodLtx25Error('Qwen Image Edit requires one to three reference images.', 'INVALID_REFERENCE_COUNT', 422);
    }
    return references.map(imageReferenceData);
}
function imagePrompt(value, label) {
    const prompt = required(value, label);
    if (prompt.length > MAX_PROMPT_CHARS) {
        throw new RunpodLtx25Error(`${label} is too long.`, 'PROMPT_TOO_LONG', 422);
    }
    return prompt;
}
function buildSdxlWorkflow(input, prompt, negativePrompt, width, height, seed) {
    const workflow = JSON.parse(JSON.stringify(sdxlWorkflowTemplate));
    workflow['2'].inputs.text = prompt;
    workflow['3'].inputs.text = negativePrompt;
    workflow['4'].inputs.width = width;
    workflow['4'].inputs.height = height;
    workflow['5'].inputs.seed = seed;
    const steps = Number(input.steps);
    if (Number.isFinite(steps))
        workflow['5'].inputs.steps = Math.max(1, Math.min(100, Math.round(steps)));
    const guidance = Number(input.guidanceScale);
    if (Number.isFinite(guidance))
        workflow['5'].inputs.cfg = Math.max(0, Math.min(30, guidance));
    return workflow;
}
function buildQwenImageEditWorkflow(prompt, negativePrompt, seed, references) {
    const workflow = JSON.parse(JSON.stringify(qwenImageEditWorkflowTemplate));
    workflow['10'].inputs.prompt = prompt;
    workflow['11'].inputs.prompt = negativePrompt;
    workflow['15'].inputs.seed = seed;
    for (let index = 1; index < references.length; index += 1) {
        const nodeId = String(7 + index);
        const inputName = `image${index + 1}`;
        workflow[nodeId] = {
            class_type: 'LoadImage',
            inputs: { image: `cinegen-qwen-reference-${index + 1}.png` },
        };
        workflow['10'].inputs[inputName] = [nodeId, 0];
        workflow['11'].inputs[inputName] = [nodeId, 0];
    }
    return workflow;
}
function buildSessionImageJob(input) {
    const model = imageJobModel(input.model);
    const prompt = imagePrompt(input.prompt, 'Image prompt');
    const negativePrompt = typeof input.negativePrompt === 'string'
        ? input.negativePrompt.trim().slice(0, MAX_PROMPT_CHARS)
        : model === 'sdxl' ? 'text, watermark, logo, low quality, distorted' : '';
    const width = imageDimension(input.width, 1024);
    const height = imageDimension(input.height, 1024);
    const seed = imageSeed(input.seed);
    const references = imageReferences(input, model);
    const workflow = model === 'sdxl'
        ? buildSdxlWorkflow(input, prompt, negativePrompt, width, height, seed)
        : buildQwenImageEditWorkflow(prompt, negativePrompt, seed, references);
    return {
        model,
        label: imageModelLabel(model),
        workflow,
        images: references.map((image, index) => ({
            name: `cinegen-qwen-reference-${index + 1}.png`,
            image,
        })),
        // Qwen's official 2511 workflow scales and VAE-encodes Picture 1 as
        // the sampler latent. Keep this false so older active Pod gateways do
        // not try to inject width/height inputs into that VAEEncode node.
        preserveInputDimensions: false,
    };
}
function outputRecords(raw, maxDepth = 8) {
    const records = [];
    const visit = (value, parentKey, depth) => {
        if (depth > maxDepth || value === null || value === undefined)
            return;
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item, parentKey, depth + 1);
            return;
        }
        if (typeof value !== 'object')
            return;
        const record = value;
        records.push({ record, parentKey });
        for (const [key, nested] of Object.entries(record))
            visit(nested, key, depth + 1);
    };
    visit(raw, '', 0);
    return records;
}
function workerFailure(raw) {
    for (const { record } of outputRecords(raw)) {
        const status = String(record.status ?? record.state ?? '').toLowerCase();
        if (!['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(status))
            continue;
        const message = record.error ?? record.message ?? record.detail;
        if (typeof message === 'string' && message.trim())
            return message.trim().slice(0, 1200);
        if (message && typeof message === 'object') {
            const nested = message.message ?? message.detail;
            if (typeof nested === 'string' && nested.trim())
                return nested.trim().slice(0, 1200);
        }
        return 'LTX-2.5 generation failed.';
    }
    return undefined;
}
function declaredMediaType(record) {
    const value = record.media_type ?? record.mediaType ?? record.mime_type ?? record.mimeType;
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}
function mediaTypeOf(record, fallback = 'video/mp4') {
    return declaredMediaType(record) || fallback;
}
function isVideoRecord(record, parentKey) {
    if (parentKey === 'videos' || parentKey === 'video')
        return true;
    const mediaType = declaredMediaType(record);
    if (mediaType.startsWith('video/'))
        return true;
    const filename = record.filename ?? record.name;
    return typeof filename === 'string' && /\.(?:mp4|webm|mov|mkv|avi|m4v)(?:$|[?#])/i.test(filename);
}
function isImageRecord(record, parentKey) {
    if (parentKey === 'images' || parentKey === 'image')
        return true;
    const mediaType = declaredMediaType(record);
    if (mediaType.startsWith('image/'))
        return true;
    const filename = record.filename ?? record.name;
    return typeof filename === 'string' && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(filename);
}
function nonEmptyString(...values) {
    return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}
function normalizeWorkerOutput(raw, durationSec) {
    const failure = workerFailure(raw);
    if (failure)
        throw new RunpodLtx25Error(failure, 'GENERATION_FAILED', 502);
    for (const { record, parentKey } of outputRecords(raw)) {
        const directUrl = nonEmptyString(record.video_url, record.videoUrl);
        if (directUrl)
            return { url: directUrl, durationSec, model: 'LTX-2.5' };
        const directData = nonEmptyString(record.video_base64, record.videoBase64);
        if (directData)
            return { data: directData, mediaType: mediaTypeOf(record), durationSec, model: 'LTX-2.5' };
        if (!isVideoRecord(record, parentKey))
            continue;
        const explicitUrl = nonEmptyString(record.url, record.download_url, record.downloadUrl);
        const typedData = nonEmptyString(record.data, record.base64);
        const url = explicitUrl ?? (String(record.type ?? '').toLowerCase() === 'url' ? typedData : undefined);
        if (url)
            return { url, durationSec, model: 'LTX-2.5' };
        const data = String(record.type ?? '').toLowerCase() === 'url' ? undefined : typedData;
        if (data)
            return { data, mediaType: mediaTypeOf(record), durationSec, model: 'LTX-2.5' };
    }
    throw new RunpodLtx25Error('LTX-2.5 completed without returning a video.', 'INVALID_PROVIDER_RESPONSE', 502);
}

function normalizeImageWorkerOutput(raw, model) {
    const label = imageModelLabel(model);
    const failure = workerFailure(raw);
    if (failure)
        throw new RunpodLtx25Error(failure, 'GENERATION_FAILED', 502);
    for (const { record, parentKey } of outputRecords(raw)) {
        const directUrl = nonEmptyString(record.image_url, record.imageUrl);
        if (directUrl)
            return { url: directUrl, model: label };
        const directData = nonEmptyString(record.image_base64, record.imageBase64);
        if (directData)
            return { data: directData, mediaType: mediaTypeOf(record, 'image/png'), model: label };
        if (!isImageRecord(record, parentKey))
            continue;
        const explicitUrl = nonEmptyString(record.url, record.download_url, record.downloadUrl);
        const typedData = nonEmptyString(record.data, record.base64);
        const url = explicitUrl ?? (String(record.type ?? '').toLowerCase() === 'url' ? typedData : undefined);
        if (url)
            return { url, model: label };
        const data = String(record.type ?? '').toLowerCase() === 'url' ? undefined : typedData;
        if (data)
            return { data, mediaType: mediaTypeOf(record, 'image/png'), model: label };
    }
    throw new RunpodLtx25Error(`${label} completed without returning an image.`, 'INVALID_PROVIDER_RESPONSE', 502);
}

function artifactDescriptor(raw, expectedKind = 'video', label = 'LTX-2.5') {
    for (const { record, parentKey } of outputRecords(raw)) {
        if (parentKey !== 'artifact')
            continue;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const byteSize = Number(record.byteSize ?? record.byte_size);
        const mediaType = typeof (record.mediaType ?? record.media_type) === 'string'
            ? String(record.mediaType ?? record.media_type).trim()
            : '';
        if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)
            || !Number.isSafeInteger(byteSize)
            || byteSize <= 0
            || byteSize > MAX_ARTIFACT_BYTES
            || (mediaType && !mediaType.startsWith(`${expectedKind}/`))) {
            throw new RunpodLtx25Error(`${label} returned invalid artifact metadata.`, 'INVALID_PROVIDER_RESPONSE', 502);
        }
        return { id, byteSize, mediaType };
    }
    return undefined;
}

function decodeArtifactChunk(value, label = 'LTX-2.5', kind = 'video') {
    if (typeof value !== 'string'
        || !value
        || value.length % 4 === 1
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
        throw new RunpodLtx25Error(`${label} returned an invalid ${kind} chunk.`, 'INVALID_PROVIDER_RESPONSE', 502);
    }
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }
    if (typeof atob !== 'function') {
        throw new RunpodLtx25Error(`This CineGen runtime cannot decode the generated ${kind}.`, 'RUNTIME_UNSUPPORTED', 500);
    }
    let decoded;
    try {
        decoded = atob(value);
    }
    catch {
        throw new RunpodLtx25Error(`${label} returned an invalid ${kind} chunk.`, 'INVALID_PROVIDER_RESPONSE', 502);
    }
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1)
        bytes[index] = decoded.charCodeAt(index);
    return bytes;
}

function artifactMediaType(firstBytes, declared, expectedKind = 'video', label = 'LTX-2.5') {
    const webm = firstBytes.length >= 4
        && firstBytes[0] === 0x1a && firstBytes[1] === 0x45
        && firstBytes[2] === 0xdf && firstBytes[3] === 0xa3;
    const mp4 = firstBytes.length >= 12
        && String.fromCharCode(...firstBytes.subarray(4, 8)) === 'ftyp';
    const png = firstBytes.length >= 8
        && firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4e
        && firstBytes[3] === 0x47 && firstBytes[4] === 0x0d && firstBytes[5] === 0x0a
        && firstBytes[6] === 0x1a && firstBytes[7] === 0x0a;
    const jpeg = firstBytes.length >= 3
        && firstBytes[0] === 0xff && firstBytes[1] === 0xd8 && firstBytes[2] === 0xff;
    const webp = firstBytes.length >= 12
        && String.fromCharCode(...firstBytes.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...firstBytes.subarray(8, 12)) === 'WEBP';
    if (expectedKind === 'image') {
        if (png)
            return 'image/png';
        if (jpeg)
            return 'image/jpeg';
        if (webp)
            return 'image/webp';
        throw new RunpodLtx25Error(`${label} returned an unsupported image file.`, 'INVALID_PROVIDER_RESPONSE', 502);
    }
    if (!webm && !mp4) {
        throw new RunpodLtx25Error(`${label} returned an unsupported video file.`, 'INVALID_PROVIDER_RESPONSE', 502);
    }
    if (webm)
        return 'video/webm';
    return declared === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
}

function encodeArtifactBytes(bytes, kind = 'media') {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    if (typeof btoa !== 'function') {
        throw new RunpodLtx25Error(`This CineGen runtime cannot encode the generated ${kind}.`, 'RUNTIME_UNSUPPORTED', 500);
    }
    const segments = [];
    const segmentBytes = 32 * 1024;
    for (let offset = 0; offset < bytes.byteLength; offset += segmentBytes) {
        const segment = bytes.subarray(offset, Math.min(bytes.byteLength, offset + segmentBytes));
        let binary = '';
        for (let index = 0; index < segment.byteLength; index += 1)
            binary += String.fromCharCode(segment[index]);
        segments.push(binary);
    }
    return btoa(segments.join(''));
}

async function cleanupArtifact(fetchImpl, target, token, artifactId) {
    try {
        const response = await fetchImpl(`${target.url}/artifact/${encodeURIComponent(artifactId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        // Drain a possible response body so pooled connections remain reusable.
        await response.arrayBuffer().catch(() => undefined);
    }
    catch {
        // The gateway's two-hour TTL is the fallback when explicit cleanup fails.
    }
}

async function downloadArtifact(fetchImpl, target, token, descriptor, expectedKind = 'video', label = 'LTX-2.5') {
    const assembled = new Uint8Array(descriptor.byteSize);
    let firstBytes;
    const chunks = [];
    for (let offset = 0; offset < descriptor.byteSize; offset += ARTIFACT_CHUNK_BYTES) {
        const length = Math.min(ARTIFACT_CHUNK_BYTES, descriptor.byteSize - offset);
        chunks.push({ offset, length });
    }
    for (let index = 0; index < chunks.length; index += ARTIFACT_DOWNLOAD_CONCURRENCY) {
        const batch = chunks.slice(index, index + ARTIFACT_DOWNLOAD_CONCURRENCY);
        const downloaded = await Promise.all(batch.map(async ({ offset, length }) => {
            const endpoint = new URL(`${target.url}/artifact/${encodeURIComponent(descriptor.id)}`);
            endpoint.searchParams.set('offset', String(offset));
            endpoint.searchParams.set('length', String(length));
            const payload = await request(fetchImpl, endpoint.toString(), {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            }, `CineGen could not download the ${label} ${expectedKind} chunk.`);
            if (!payload || typeof payload !== 'object') {
                throw new RunpodLtx25Error(`${label} returned an invalid ${expectedKind} chunk.`, 'INVALID_PROVIDER_RESPONSE', 502);
            }
            const chunkId = typeof payload.id === 'string' ? payload.id : '';
            const chunkOffset = Number(payload.offset);
            const totalSize = Number(payload.byteSize ?? payload.byte_size);
            const chunkMediaType = typeof (payload.mediaType ?? payload.media_type) === 'string'
                ? String(payload.mediaType ?? payload.media_type).trim()
                : '';
            const bytes = decodeArtifactChunk(payload.data, label, expectedKind);
            if (chunkId !== descriptor.id
                || chunkOffset !== offset
                || totalSize !== descriptor.byteSize
                || (descriptor.mediaType && chunkMediaType !== descriptor.mediaType)
                || bytes.byteLength !== length) {
                throw new RunpodLtx25Error(`${label} returned an inconsistent ${expectedKind} chunk.`, 'INVALID_PROVIDER_RESPONSE', 502);
            }
            return { offset, bytes };
        }));
        for (const chunk of downloaded) {
            if (chunk.offset === 0)
                firstBytes = chunk.bytes.slice(0, 12);
            assembled.set(chunk.bytes, chunk.offset);
        }
    }
    const mediaType = artifactMediaType(firstBytes ?? new Uint8Array(), descriptor.mediaType, expectedKind, label);
    const data = encodeArtifactBytes(assembled, expectedKind);
    await cleanupArtifact(fetchImpl, target, token, descriptor.id);
    return { data, mediaType };
}

function supportsReliableArtifactTransfer(payload) {
    if (!payload || typeof payload !== 'object')
        return false;
    const capabilities = payload.capabilities;
    return Number(payload.apiVersion) >= 2
        && capabilities
        && typeof capabilities === 'object'
        && capabilities.artifactChunks === true;
}

async function requireReliableGateway(fetchImpl, target, token) {
    const payload = await request(fetchImpl, `${target.url}/health`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 'CineGen could not verify the LTX-2.5 session.');
    if (supportsReliableArtifactTransfer(payload))
        return payload;
    throw new RunpodLtx25Error(
        'This LTX-2.5 Pod was started before CineGen\'s reliable video-transfer update. End this session in Settings, then start a new LTX-2.5 session before rendering again.',
        'SESSION_UPDATE_REQUIRED',
        409,
    );
}

async function requireSessionImageGateway(fetchImpl, target, token, model) {
    const payload = await requireReliableGateway(fetchImpl, target, token);
    const capabilities = payload?.capabilities;
    const installedModels = Array.isArray(payload?.installedModels) ? payload.installedModels : [];
    if (capabilities?.imageArtifacts !== true) {
        throw new RunpodLtx25Error(
            'This Pod was started before CineGen added session image generation. End it, then start a new session with the image model selected.',
            'SESSION_UPDATE_REQUIRED',
            409,
        );
    }
    if (!installedModels.includes(model)) {
        throw new RunpodLtx25Error(
            `${imageModelLabel(model)} was not installed when this Pod was created. Start a new session with that image model selected.`,
            'IMAGE_MODEL_NOT_INSTALLED',
            409,
        );
    }
    return payload;
}

function newGenerationJobId() {
    return crypto.randomUUID().replace(/-/g, '').toLowerCase();
}

function submissionMayHaveReachedGateway(error) {
    return error instanceof RunpodLtx25Error
        && (error.code === 'PROVIDER_TIMEOUT'
            || error.code === 'PROVIDER_UNREACHABLE'
            || error.statusCode === 502
            || error.statusCode === 504);
}

async function recoverSubmittedJob(fetchImpl, target, token, jobId) {
    try {
        const payload = await request(fetchImpl, `${target.url}/status/${jobId}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }, 'CineGen could not recover the submitted generation.', [200, 404]);
        return payload && typeof payload === 'object' && payload.id === jobId ? payload : undefined;
    }
    catch {
        return undefined;
    }
}

async function submitGatewayJob(fetchImpl, target, token, headers, gateway, input, fallback) {
    const clientJobId = newGenerationJobId();
    const idempotent = gateway?.capabilities?.idempotentSubmissions === true;
    const body = JSON.stringify({ input: { ...input, cinegen_job_id: clientJobId } });
    const submit = () => request(fetchImpl, `${target.url}/run`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': clientJobId },
        body,
    }, fallback, undefined, POD_SUBMISSION_TIMEOUT_MS);
    for (let attempt = 0; attempt < (idempotent ? 2 : 1); attempt += 1) {
        try {
            const payload = await submit();
            const returnedJobId = typeof payload?.id === 'string' ? payload.id : '';
            if (!returnedJobId) {
                throw new RunpodLtx25Error('The session did not return a generation job ID.', 'INVALID_PROVIDER_RESPONSE', 502);
            }
            if (idempotent && returnedJobId !== clientJobId) {
                throw new RunpodLtx25Error('The session returned a different generation job ID.', 'INVALID_PROVIDER_RESPONSE', 502);
            }
            return { payload, jobId: returnedJobId };
        }
        catch (error) {
            if (!idempotent || !submissionMayHaveReachedGateway(error))
                throw error;
            const recovered = await recoverSubmittedJob(fetchImpl, target, token, clientJobId);
            if (recovered)
                return { payload: recovered, jobId: clientJobId };
            if (attempt === 1)
                throw error;
        }
    }
    throw new RunpodLtx25Error('CineGen could not confirm the generation submission.', 'PROVIDER_TIMEOUT', 504);
}

export async function runRunpodLtx25Job(params, fetchImpl = fetch) {
    const target = validatePodUrl(params.podUrl, params.podId);
    const token = required(params.podAuthToken, 'RunPod session token');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (params.jobId) {
        const jobId = safeId(params.jobId, 'RunPod generation job ID');
        const payload = await request(fetchImpl, `${target.url}/status/${jobId}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }, 'CineGen could not read the LTX-2.5 generation status.');
        const status = String(payload.status ?? '').toUpperCase();
        if (status === 'IN_QUEUE')
            return { jobId, status: 'queued', phase: 'rendering', message: 'Waiting for the LTX-2.5 renderer…' };
        if (status === 'IN_PROGRESS')
            return { jobId, status: 'in_progress', phase: 'rendering', message: 'LTX-2.5 is rendering the video…' };
        if (status === 'FAILED')
            return { jobId, status: 'failed', phase: 'error', error: providerMessage(payload, 'LTX-2.5 generation failed.') };
        if (status === 'COMPLETED') {
            const durationSec = Math.min(20, Math.max(1, Math.round(Number(payload.durationSec) || 5)));
            try {
                const artifact = artifactDescriptor(payload.output);
                const output = artifact
                    ? { ...(await downloadArtifact(fetchImpl, target, token, artifact)), durationSec, model: 'LTX-2.5' }
                    : normalizeWorkerOutput(payload.output, durationSec);
                return { jobId, status: 'completed', phase: 'ready', output };
            }
            catch (error) {
                return { jobId, status: 'failed', phase: 'error', error: error instanceof Error ? error.message : 'LTX-2.5 generation failed.' };
            }
        }
        return { jobId, status: 'in_progress', phase: 'rendering', message: 'LTX-2.5 is preparing the video…' };
    }
    if (!params.input)
        throw new RunpodLtx25Error('Video generation input is required.', 'MISSING_INPUT', 422);
    const durationSec = Math.min(20, Math.max(1, Math.round(Number(params.input.durationSec) || 5)));
    const submissionInput = {
        workflow: buildWorkflow(params.input),
        images: [{ name: 'cinegen-source.png', image: imageData(params.input) }],
        cinegen_duration_sec: durationSec,
        cinegen_task: 'ltx-2.5',
    };
    // A legacy gateway can finish a paid render but time out while returning
    // its inline MP4. Refuse only new submissions; saved job IDs can still be
    // polled without creating a second render.
    const gateway = await requireReliableGateway(fetchImpl, target, token);
    const { jobId } = await submitGatewayJob(fetchImpl, target, token, headers, gateway, submissionInput, 'CineGen could not submit the LTX-2.5 generation.');
    return { jobId, status: 'queued', phase: 'rendering', message: 'LTX-2.5 generation queued.' };
}

export async function runRunpodSessionImageJob(params, fetchImpl = fetch) {
    const target = validatePodUrl(params.podUrl, params.podId);
    const token = required(params.podAuthToken, 'RunPod session token');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (params.jobId) {
        const jobId = safeId(params.jobId, 'RunPod generation job ID');
        const payload = await request(fetchImpl, `${target.url}/status/${jobId}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }, 'CineGen could not read the session image generation status.');
        const reportedModel = optionalImageJobModel(payload?.task);
        const expectedModel = optionalImageJobModel(params.model ?? params.input?.model);
        if (reportedModel && expectedModel && reportedModel !== expectedModel) {
            return { jobId, status: 'failed', phase: 'error', error: 'The Pod returned an image-generation task that does not match this job.' };
        }
        const model = reportedModel ?? expectedModel;
        if (!model) {
            return { jobId, status: 'failed', phase: 'error', error: 'The Pod returned an invalid image-generation task.' };
        }
        const label = imageModelLabel(model);
        const status = String(payload.status ?? '').toUpperCase();
        if (status === 'IN_QUEUE')
            return { jobId, status: 'queued', phase: 'rendering', message: `Waiting for the ${label} renderer…` };
        if (status === 'IN_PROGRESS')
            return { jobId, status: 'in_progress', phase: 'rendering', message: `${label} is rendering the image…` };
        if (status === 'FAILED')
            return { jobId, status: 'failed', phase: 'error', error: providerMessage(payload, `${label} generation failed.`) };
        if (status === 'COMPLETED') {
            try {
                const artifact = artifactDescriptor(payload.output, 'image', label);
                const output = artifact
                    ? { ...(await downloadArtifact(fetchImpl, target, token, artifact, 'image', label)), model: label }
                    : normalizeImageWorkerOutput(payload.output, model);
                return { jobId, status: 'completed', phase: 'ready', output };
            }
            catch (error) {
                return { jobId, status: 'failed', phase: 'error', error: error instanceof Error ? error.message : `${label} generation failed.` };
            }
        }
        return { jobId, status: 'in_progress', phase: 'rendering', message: `${label} is preparing the image…` };
    }
    if (!params.input)
        throw new RunpodLtx25Error('Image generation input is required.', 'MISSING_INPUT', 422);
    const imageJob = buildSessionImageJob(params.input);
    const gateway = await requireSessionImageGateway(fetchImpl, target, token, imageJob.model);
    const { jobId } = await submitGatewayJob(fetchImpl, target, token, headers, gateway, {
        workflow: imageJob.workflow,
        images: imageJob.images,
        cinegen_task: imageJob.model,
        cinegen_preserve_input_dimensions: imageJob.preserveInputDimensions,
    }, `CineGen could not submit the ${imageJob.label} generation.`);
    return { jobId, status: 'queued', phase: 'rendering', message: `${imageJob.label} generation queued.` };
}
