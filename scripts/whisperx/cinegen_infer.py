#!/usr/bin/env python3
"""CineGen WhisperX transcription script with segment and word timestamps."""

import argparse
import gc
import json
import os
import sys
import tempfile
import time


def log(msg_type: str, **kwargs):
    print(json.dumps({"type": msg_type, **kwargs}), flush=True)


def round_time(value):
    if value is None:
        return None
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


def build_words(raw_words, segment_speaker):
    words = []
    for raw_word in raw_words or []:
        word_text = str(raw_word.get("word", "")).strip()
        start = round_time(raw_word.get("start"))
        end = round_time(raw_word.get("end"))
        if not word_text or start is None or end is None:
            continue

        score = raw_word.get("score")
        prob = None
        try:
            if score is not None:
                prob = round(float(score), 4)
        except (TypeError, ValueError):
            prob = None

        words.append({
            "word": word_text,
            "start": start,
            "end": end,
            "prob": prob,
            "speaker": raw_word.get("speaker", segment_speaker),
        })
    return words


def ensure_runtime_cache():
    cache_root = os.path.join(tempfile.gettempdir(), "cinegen-whisperx-cache")
    matplotlib_dir = os.path.join(cache_root, "matplotlib")
    torch_home = os.path.join(os.path.expanduser("~"), ".cache", "torch")
    os.makedirs(matplotlib_dir, exist_ok=True)
    os.makedirs(torch_home, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", matplotlib_dir)
    os.environ.setdefault("TORCH_HOME", torch_home)
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def resolve_alignment_device(torch_module):
    mps_backend = getattr(torch_module.backends, "mps", None)
    if mps_backend and mps_backend.is_available():
        return "mps"
    return "cpu"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio_path", required=True)
    parser.add_argument("--model", default="base", choices=["base", "medium", "large-v3"])
    parser.add_argument("--language", default=None)
    parser.add_argument("--diarize", action="store_true", default=True)
    parser.add_argument("--no_diarize", action="store_true", default=False)
    parser.add_argument("--hf_token", default=None)
    args = parser.parse_args()

    diarize = args.diarize and not args.no_diarize

    if not os.path.isfile(args.audio_path):
        log("error", error=f"Audio file not found: {args.audio_path}")
        sys.exit(1)

    ensure_runtime_cache()

    log("progress", stage="init", message=f"Loading WhisperX model: {args.model}")

    import torch
    from faster_whisper import WhisperModel
    import whisperx

    transcribe_device = "cpu"
    compute_type = "int8"
    align_device = resolve_alignment_device(torch)

    log(
        "progress",
        stage="loading",
        message=f"Transcription: {transcribe_device}/{compute_type}; word alignment: {align_device}",
    )

    model = WhisperModel(
        args.model,
        device=transcribe_device,
        compute_type=compute_type,
        cpu_threads=max(1, os.cpu_count() or 4),
    )

    log("progress", stage="preparing_audio", message="Preparing audio stream...")
    audio = whisperx.load_audio(args.audio_path)

    log("progress", stage="transcribing", message="Transcribing audio...")

    t0 = time.time()
    segments_iter, info = model.transcribe(
        audio,
        language=args.language or None,
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
        vad_filter=False,
        word_timestamps=False,
    )
    t_transcribe = time.time() - t0

    raw_segments = []
    initial_segments = []
    for seg in segments_iter:
        text = seg.text.strip()
        segment_payload = {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": text,
        }
        raw_segments.append(segment_payload)
        initial_segments.append({
            "start": segment_payload["start"],
            "end": segment_payload["end"],
            "text": text,
            "speaker": None,
            "words": [],
        })
    detected_language = getattr(info, "language", None) or args.language or "unknown"
    result = {
        "language": detected_language,
        "segments": raw_segments,
    }
    initial_text = " ".join(segment["text"] for segment in initial_segments if segment["text"])
    log(
        "progress",
        stage="segments_ready",
        message="Sentence transcript ready. Refining word timestamps...",
        output_text=initial_text,
        segments=initial_segments,
        language=detected_language,
    )
    log(
        "progress",
        stage="loading_align_model",
        message=f"Loading word alignment model ({detected_language}) on {align_device}...",
    )

    del model
    gc.collect()
    if align_device == "mps":
        torch.mps.empty_cache()

    model_a, metadata = whisperx.load_align_model(
        language_code=detected_language,
        device=align_device,
    )
    log(
        "progress",
        stage="aligning_words",
        message=f"Computing word timestamps on {align_device}...",
    )
    result = whisperx.align(
        result["segments"],
        model_a,
        metadata,
        audio,
        align_device,
        return_char_alignments=False,
    )

    if diarize:
        hf_token = args.hf_token or os.environ.get("HF_TOKEN")
        if hf_token:
            diarize_device = align_device
            log(
                "progress",
                stage="diarizing",
                message=f"Speaker diarization on {diarize_device}...",
            )
            try:
                diarize_model = whisperx.DiarizationPipeline(
                    use_auth_token=hf_token,
                    device=diarize_device,
                )
                diarize_segments = diarize_model(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
            except Exception as exc:
                log("progress", stage="diarize_skip", message=f"Diarization skipped: {exc}")
        else:
            log("progress", stage="diarize_skip", message="Diarization skipped: no HF_TOKEN set")

    segments = []
    for seg in result.get("segments", []):
        speaker = seg.get("speaker", None)
        words = build_words(seg.get("words", []), speaker)
        segments.append({
            "start": round(seg.get("start", 0), 3),
            "end": round(seg.get("end", 0), 3),
            "text": seg.get("text", "").strip(),
            "speaker": speaker,
            "words": words,
        })

    full_text = " ".join(segment["text"] for segment in segments if segment["text"])
    log("progress", stage="finalizing", message="Finalizing transcript...")

    transcript_payload = {
        "output_text": full_text,
        "segments": segments,
        "language": detected_language,
        "duration": round(t_transcribe, 2),
        "model": args.model,
    }
    transcript_file = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="cinegen-whisperx-",
        delete=False,
        encoding="utf-8",
    )
    with transcript_file:
        json.dump(transcript_payload, transcript_file)

    del model_a
    gc.collect()
    if align_device == "mps":
        torch.mps.empty_cache()

    summary_segments = []
    for seg in segments:
        summary_segments.append({
            "start": seg["start"],
            "end": seg["end"],
            "text": seg["text"],
            "speaker": seg["speaker"],
            "words": [],
        })

    log(
        "done",
        output_text=full_text,
        segments=summary_segments,
        language=detected_language,
        transcript_path=transcript_file.name,
    )


if __name__ == "__main__":
    main()
