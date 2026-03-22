#!/usr/bin/env python3
"""CineGen Layer Decompose — automatic hybrid layer extraction."""

import argparse
import json
import os
import re
import sys
import tempfile
import time

import cv2
import numpy as np
from PIL import Image


AUTO_PROMPT_BANK = [
    "logo",
    "icon",
    "symbol",
    "badge",
    "sticker",
    "shape",
    "illustration",
    "graphic",
    "button",
    "panel",
    "photo",
    "portrait",
    "person",
    "product",
    "device",
    "object",
    "decoration",
]

LAYER_TYPE_MAP = {
    "logo": "graphic",
    "icon": "graphic",
    "symbol": "graphic",
    "badge": "graphic",
    "sticker": "graphic",
    "shape": "shape",
    "illustration": "graphic",
    "graphic": "graphic",
    "button": "ui",
    "panel": "ui",
    "photo": "photograph",
    "portrait": "photograph",
    "person": "subject",
    "product": "object",
    "device": "object",
    "object": "object",
    "decoration": "shape",
}


def log(msg_type: str, **kwargs):
    print(json.dumps({"type": msg_type, **kwargs}), flush=True)


def slugify(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or fallback


def mask_area(mask: np.ndarray) -> int:
    return int(np.count_nonzero(mask))


def bbox_from_mask(mask: np.ndarray):
    coords = cv2.findNonZero(mask)
    if coords is None:
        return None
    x, y, w, h = cv2.boundingRect(coords)
    return (int(x), int(y), int(x + w), int(y + h))


def bbox_iou(a, b) -> float:
    if not a or not b:
        return 0.0
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    union = area_a + area_b - inter
    return float(inter / union) if union > 0 else 0.0


def mask_overlap(smaller: np.ndarray, larger: np.ndarray) -> float:
    inter = mask_area(cv2.bitwise_and(smaller, larger))
    denom = min(mask_area(smaller), mask_area(larger))
    return float(inter / denom) if denom > 0 else 0.0


def infer_layer_type(label: str) -> str:
    return LAYER_TYPE_MAP.get(label.lower(), "layer")


def build_prompt_bank(prompt_text: str):
    prompts = []
    if prompt_text:
        for part in prompt_text.split(","):
            cleaned = slugify(part, "").replace("_", " ").strip()
            if cleaned:
                prompts.append(cleaned)

    merged = []
    seen = set()
    for item in prompts + AUTO_PROMPT_BANK:
        normalized = item.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    return merged


def smooth_mask(mask: np.ndarray) -> np.ndarray:
    out = (mask > 0).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, kernel)
    out = cv2.morphologyEx(out, cv2.MORPH_OPEN, kernel)
    return out


def split_connected_components(mask: np.ndarray, min_area: int):
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), connectivity=8)
    components = []
    for label_idx in range(1, num_labels):
        area = int(stats[label_idx, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        component = np.where(labels == label_idx, 255, 0).astype(np.uint8)
        bbox = bbox_from_mask(component)
        if not bbox:
            continue
        components.append((component, bbox, area))
    return components


def merge_masks(masks):
    if not masks:
        return None
    combined = np.zeros_like(masks[0])
    for mask in masks:
        combined = cv2.bitwise_or(combined, mask)
    return combined


def extract_with_alpha(image: Image.Image, mask: np.ndarray) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = cv2.GaussianBlur(mask, (3, 3), 0)
    rgba_array = np.array(rgba)
    rgba_array[:, :, 3] = alpha
    return Image.fromarray(rgba_array)


def dilate_mask(mask: np.ndarray, pixels=4):
    kernel = np.ones((pixels * 2 + 1, pixels * 2 + 1), np.uint8)
    return cv2.dilate(mask, kernel)


def save_mask(mask: np.ndarray, out_dir: str, name: str) -> str:
    path = os.path.join(out_dir, f"{name}_mask.png")
    cv2.imwrite(path, mask)
    return path


def inpaint_lama(image: Image.Image, mask: np.ndarray) -> Image.Image:
    from simple_lama_inpainting import SimpleLama

    lama = SimpleLama()
    mask_pil = Image.fromarray(mask)
    return lama(image, mask_pil)


def detect_text(image_path: str):
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(lang="en")
    results = ocr.predict(image_path)

    regions = []
    if results:
        for result in results:
            if hasattr(result, "rec_texts"):
                for i, text in enumerate(result.rec_texts):
                    conf = result.rec_scores[i] if i < len(result.rec_scores) else 0.0
                    bbox = result.dt_polys[i].tolist() if i < len(result.dt_polys) else []
                    if text.strip() and bbox:
                        regions.append({"text": text, "bbox": bbox, "confidence": float(conf)})
            elif isinstance(result, list):
                for line in result:
                    if line and len(line) >= 2:
                        regions.append({
                            "bbox": line[0],
                            "text": line[1][0],
                            "confidence": float(line[1][1]),
                        })
    return regions


def text_region_to_mask(region, image_size):
    w, h = image_size
    mask = np.zeros((h, w), dtype=np.uint8)
    pts = np.array(region["bbox"], dtype=np.int32)
    cv2.fillPoly(mask, [pts], 255)
    return mask


def apply_exclude_masks(mask, exclude_masks):
    if not exclude_masks:
        return mask
    combined = merge_masks(exclude_masks)
    if combined is None:
        return mask
    return cv2.bitwise_and(mask, cv2.bitwise_not(combined))


def run_prompt_bank_segmentation(image: Image.Image, prompt_bank, exclude_masks=None):
    import torch
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dino_model_id = "IDEA-Research/grounding-dino-base"

    dino_processor = AutoProcessor.from_pretrained(dino_model_id)
    dino_model = AutoModelForZeroShotObjectDetection.from_pretrained(dino_model_id).to(device)

    text_query = ". ".join(prompt_bank) + "."
    dino_inputs = dino_processor(images=image, text=text_query, return_tensors="pt").to(device)
    with torch.no_grad():
        dino_outputs = dino_model(**dino_inputs)

    dino_results = dino_processor.post_process_grounded_object_detection(
        dino_outputs,
        dino_inputs.input_ids,
        box_threshold=0.22,
        text_threshold=0.18,
        target_sizes=[image.size[::-1]],
    )[0]

    if len(dino_results["boxes"]) == 0:
        return []

    predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2.1-hiera-large", device=device)
    predictor.set_image(np.array(image))

    masks_out, _, _ = predictor.predict(
        box=dino_results["boxes"].cpu().numpy(),
        multimask_output=False,
    )

    candidates = []
    labels = dino_results["labels"]
    scores = dino_results["scores"].cpu().numpy()
    for i in range(len(labels)):
        raw_mask = masks_out[i][0] if masks_out[i].ndim == 3 else masks_out[i]
        mask = smooth_mask((raw_mask > 0).astype(np.uint8) * 255)
        mask = apply_exclude_masks(mask, exclude_masks)
        area = mask_area(mask)
        bbox = bbox_from_mask(mask)
        if area <= 0 or not bbox:
            continue
        label = str(labels[i]).strip().lower().replace(" ", "_")
        candidates.append({
            "source": "prompt_bank",
            "label": label,
            "type": infer_layer_type(label),
            "confidence": float(scores[i]) if i < len(scores) else 0.75,
            "mask": mask,
            "bbox": bbox,
            "area": area,
        })
    return candidates


def run_auto_segmentation(image: Image.Image, exclude_masks=None):
    import torch
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    generator = SAM2AutomaticMaskGenerator.from_pretrained(
        "facebook/sam2.1-hiera-large",
        device=device,
        points_per_side=48,
        pred_iou_thresh=0.75,
        stability_score_thresh=0.88,
        min_mask_region_area=120,
    )

    candidates = []
    for ann in generator.generate(np.array(image)):
        mask = smooth_mask(ann["segmentation"].astype(np.uint8) * 255)
        mask = apply_exclude_masks(mask, exclude_masks)
        area = mask_area(mask)
        bbox = bbox_from_mask(mask)
        if area <= 0 or not bbox:
            continue
        candidates.append({
            "source": "auto",
            "label": "layer",
            "type": "layer",
            "confidence": float(ann.get("predicted_iou", ann.get("stability_score", 0.65))),
            "mask": mask,
            "bbox": bbox,
            "area": area,
        })
    return candidates


def expand_and_split_candidates(candidates, min_area: int):
    expanded = []
    for candidate in candidates:
        mask = smooth_mask(candidate["mask"])
        for idx, (component, bbox, area) in enumerate(split_connected_components(mask, min_area)):
            clone = {
                **candidate,
                "mask": component,
                "bbox": bbox,
                "area": area,
                "component_index": idx,
            }
            expanded.append(clone)
    return expanded


def is_background_like(candidate, image_size) -> bool:
    width, height = image_size
    total_area = width * height
    coverage = candidate["area"] / total_area if total_area > 0 else 0
    bbox = candidate["bbox"]
    touches_left = bbox[0] <= 2
    touches_top = bbox[1] <= 2
    touches_right = bbox[2] >= width - 2
    touches_bottom = bbox[3] >= height - 2
    touched_edges = sum([touches_left, touches_top, touches_right, touches_bottom])
    return coverage > 0.72 or (coverage > 0.35 and touched_edges >= 3)


def dedupe_candidates(candidates, image_size):
    priority = {"prompt_bank": 0, "auto": 1}
    ordered = sorted(
        candidates,
        key=lambda c: (priority.get(c["source"], 99), c["area"], -(c["confidence"])),
    )

    accepted = []
    for candidate in ordered:
        if is_background_like(candidate, image_size):
            continue

        duplicate_index = None
        for idx, existing in enumerate(accepted):
            if bbox_iou(existing["bbox"], candidate["bbox"]) < 0.78:
                continue
            overlap = mask_overlap(existing["mask"], candidate["mask"])
            if overlap < 0.9:
                continue

            existing_priority = priority.get(existing["source"], 99)
            candidate_priority = priority.get(candidate["source"], 99)
            keep_candidate = (
                candidate_priority < existing_priority
                or (
                    candidate_priority == existing_priority
                    and candidate["confidence"] > existing["confidence"]
                )
                or (
                    abs(candidate["confidence"] - existing["confidence"]) < 0.05
                    and candidate["area"] < existing["area"]
                )
            )
            if keep_candidate:
                duplicate_index = idx
            else:
                duplicate_index = -1
            break

        if duplicate_index is None:
            accepted.append(candidate)
        elif duplicate_index >= 0:
            accepted[duplicate_index] = candidate

    return accepted


def resolve_layer_masks(candidates, reserved_mask, min_area):
    claimed = reserved_mask.copy() if reserved_mask is not None else None
    resolved = []

    ordered = sorted(
        candidates,
        key=lambda c: (
            0 if c["source"] == "prompt_bank" else 1,
            c["area"],
            -(c["confidence"]),
        ),
    )

    for candidate in ordered:
        current = candidate["mask"]
        if claimed is not None:
            current = cv2.bitwise_and(current, cv2.bitwise_not(claimed))
        current = smooth_mask(current)
        if mask_area(current) < min_area:
            continue
        bbox = bbox_from_mask(current)
        if not bbox:
            continue

        updated = {
            **candidate,
            "mask": current,
            "bbox": bbox,
            "area": mask_area(current),
        }
        resolved.append(updated)
        claimed = current if claimed is None else cv2.bitwise_or(claimed, current)

    return resolved


def build_visual_candidates(image: Image.Image, exclude_masks, prompt_text: str):
    width, height = image.size
    min_area = max(140, int(width * height * 0.00035))
    prompt_bank = build_prompt_bank(prompt_text)

    prompt_candidates = []
    try:
        prompt_candidates = run_prompt_bank_segmentation(image, prompt_bank, exclude_masks=exclude_masks)
    except Exception as err:
        log("progress", stage="segmentation", message=f"Prompt-bank pass skipped: {err}")

    auto_candidates = []
    try:
        auto_candidates = run_auto_segmentation(image, exclude_masks=exclude_masks)
    except Exception as err:
        log("progress", stage="segmentation", message=f"Automatic mask pass skipped: {err}")

    expanded = expand_and_split_candidates(prompt_candidates + auto_candidates, min_area=min_area)
    deduped = dedupe_candidates(expanded, image.size)
    reserved = merge_masks(exclude_masks) if exclude_masks else None
    return resolve_layer_masks(deduped, reserved_mask=reserved, min_area=min_area)


def main():
    parser = argparse.ArgumentParser(description="Layer Decompose — automatic hybrid pipeline")
    parser.add_argument("--image_path", required=True, help="Path to input image")
    parser.add_argument("--prompts", default="", help="Comma-separated segmentation hints")
    parser.add_argument("--inpainter", default="none", choices=["lama", "none"], help="Inpainting engine")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output_dir", default=None, help="Output directory (default: system temp)")
    args = parser.parse_args()

    if not os.path.isfile(args.image_path):
        log("error", error=f"Input image not found: {args.image_path}")
        sys.exit(1)

    try:
        np.random.seed(args.seed)
        out_dir = args.output_dir or os.path.join(tempfile.gettempdir(), f"layer-decompose-{int(time.time())}")
        os.makedirs(out_dir, exist_ok=True)

        image = Image.open(args.image_path).convert("RGB")
        log("progress", stage="ocr", message="Separating text and artwork")

        try:
            text_regions = detect_text(args.image_path)
        except Exception as err:
            log("progress", stage="ocr", message=f"OCR failed: {err}; continuing without text extraction")
            text_regions = []

        text_masks = [text_region_to_mask(region, image.size) for region in text_regions]
        log("progress", stage="segmentation", message="Finding visual layers")
        visual_candidates = build_visual_candidates(image, text_masks, args.prompts)

        log("progress", stage="masks", message="Cleaning and separating masks")
        text_layers = []
        combined_foreground_masks = []
        z_order = 1

        for idx, region in enumerate(text_regions):
            mask = dilate_mask(text_masks[idx], pixels=3)
            combined_foreground_masks.append(mask)

            layer_slug = slugify(region["text"][:30], f"text_{idx + 1}")
            mask_path = save_mask(mask, out_dir, f"{z_order:02d}_{layer_slug}")
            layer_path = os.path.join(out_dir, f"{z_order:02d}_{layer_slug}.png")
            extract_with_alpha(image, mask).save(layer_path)
            text_layers.append({
                "path": layer_path,
                "name": f"Text: {region['text'][:30]}",
                "type": "text",
                "z_order": z_order,
                "metadata": {
                    "text": region["text"],
                    "confidence": region["confidence"],
                    "bbox": region["bbox"],
                    "mask_path": mask_path,
                    "source": "ocr",
                },
            })
            z_order += 1

        log("progress", stage="extraction", message="Extracting isolated layers")
        element_layers = []
        type_counts = {}
        for candidate in visual_candidates:
            mask = dilate_mask(candidate["mask"], pixels=2)
            combined_foreground_masks.append(mask)

            layer_type = candidate["type"]
            type_counts[layer_type] = type_counts.get(layer_type, 0) + 1
            index = type_counts[layer_type]
            base_name = candidate["label"] if candidate["label"] != "layer" else layer_type
            layer_slug = slugify(f"{base_name}_{index}", f"{layer_type}_{index}")
            mask_path = save_mask(mask, out_dir, f"{z_order:02d}_{layer_slug}")
            layer_path = os.path.join(out_dir, f"{z_order:02d}_{layer_slug}.png")
            extract_with_alpha(image, mask).save(layer_path)

            display_name = f"{base_name.replace('_', ' ').title()} {index}" if base_name != layer_type else f"{layer_type.title()} {index}"
            element_layers.append({
                "path": layer_path,
                "name": display_name,
                "type": layer_type,
                "z_order": z_order,
                "metadata": {
                    "bbox": list(candidate["bbox"]),
                    "confidence": candidate["confidence"],
                    "mask_path": mask_path,
                    "source": candidate["source"],
                    "prompt": candidate["label"],
                    "area": candidate["area"],
                },
            })
            z_order += 1

        combined_mask = merge_masks(combined_foreground_masks)
        combined_mask_path = None
        if combined_mask is not None:
            combined_mask_path = os.path.join(out_dir, "combined_mask.png")
            cv2.imwrite(combined_mask_path, combined_mask)

        log("progress", stage="inpainting", message="Rebuilding the clean background plate")
        needs_inpainting = False
        bg_path = os.path.join(out_dir, "00_background.png")
        if combined_mask is not None and args.inpainter == "lama":
            inpaint_lama(image, combined_mask).convert("RGBA").save(bg_path)
        elif combined_mask is not None and args.inpainter == "none":
            bg_rgba = image.convert("RGBA")
            bg_array = np.array(bg_rgba)
            bg_array[:, :, 3] = cv2.bitwise_not(combined_mask)
            Image.fromarray(bg_array).save(bg_path)
            needs_inpainting = True
        else:
            image.convert("RGBA").save(bg_path)

        layers = [{
            "path": bg_path,
            "name": "Background",
            "type": "background",
            "z_order": 0,
            "metadata": {
                "source": (
                    "reconstructed"
                    if combined_mask is not None and args.inpainter == "lama"
                    else "plate"
                    if combined_mask is not None
                    else "original"
                ),
                "combined_mask_path": combined_mask_path,
            },
        }]
        layers.extend(text_layers)
        layers.extend(element_layers)

        log("progress", stage="saving", message=f"Saving {len(layers)} layers")
        metadata = {
            "source": args.image_path,
            "source_size": list(image.size),
            "layer_count": len(layers),
            "layers": layers,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2)

        log(
            "done",
            output_path=bg_path,
            combined_mask_path=combined_mask_path,
            needs_inpainting=needs_inpainting,
            layers=layers,
        )
    except Exception as err:
        log("error", error=str(err))
        sys.exit(1)


if __name__ == "__main__":
    main()
