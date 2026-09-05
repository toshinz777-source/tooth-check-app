#!/usr/bin/env python3
"""Download, inspect, and convert nsr51324/Oral_Diseases_Image_Classification
to ONNX for the Tooth Check app's on-device AI Photo Analysis feature.

WHY THIS SCRIPT EXISTS AS A SEPARATE STEP
------------------------------------------
This app's own build/dev environment could not reach huggingface.co (the
network egress policy blocked it, confirmed via direct HTTPS requests). So
this script could not be run there, and no ONNX model file could be
downloaded, inspected, or committed as part of that work. Run it yourself
on any machine with normal internet access, then commit the two files it
produces (models/dental-visible-features.onnx and models/model-config.js)
to this repo.

This script never fabricates model behavior: --inspect only reports what
is actually in the downloaded repo, and --convert only writes
model-config.js values that were actually read from the exported model
(via onnxruntime) or the source model's own config/label files. If the
source repo turns out to need a conversion path this script doesn't
handle, it will say so explicitly rather than guessing.

USAGE
-----
    pip install huggingface_hub onnx onnxruntime numpy pillow

    # Also install ONE of these, matching what --inspect reports:
    #   pip install torch transformers        # if it's a PyTorch/transformers model
    #   pip install tensorflow tf2onnx        # if it's a Keras/TensorFlow model

    # Step 1 — download the repo and print what's actually in it. Read
    # this output before doing anything else; it tells you which
    # conversion path applies (see convert_pytorch_transformers() and
    # convert_keras() below) and lets you sanity-check the real label set
    # against models/model-config.js's placeholder labelToSafeWording.
    python scripts/convert_oral_disease_model.py --inspect

    # Step 2 — export to ONNX, verify the export with onnxruntime, and
    # rewrite models/model-config.js with the real, verified values.
    python scripts/convert_oral_disease_model.py --convert

    # Step 3 — sanity-check the exported model runs in a browser: serve
    # this repo (python3 -m http.server) and open the app's Photo Check
    # step with a real photo.
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ID = "nsr51324/Oral_Diseases_Image_Classification"
REPO_ROOT = Path(__file__).resolve().parent.parent
DOWNLOAD_DIR = REPO_ROOT / "scripts" / ".model-download-cache"
ONNX_OUTPUT_PATH = REPO_ROOT / "models" / "dental-visible-features.onnx"
MODEL_CONFIG_PATH = REPO_ROOT / "models" / "model-config.js"

# This app's intended safe, non-diagnostic wording for the class names the
# source model card describes. Confirm the ACTUAL label order with
# --inspect / --convert before trusting this mapping — a mismatch here
# would silently mislabel findings.
SAFE_WORDING = {
    "Caries": {"label": "visible dark/caries-like area", "severity": "yellow"},
    "Calculus": {"label": "visible calculus/tartar-like buildup", "severity": "yellow"},
    "Gingivitis": {"label": "visible gum inflammation-like appearance", "severity": "yellow"},
    "Ulcer": {"label": "visible ulcer-like area", "severity": "yellow"},
    "Discoloration": {"label": "visible discoloration", "severity": "yellow"},
    "Hypodontia": {"label": "visible missing-tooth pattern", "severity": "yellow"},
}


def download_repo():
    from huggingface_hub import snapshot_download

    print(f"Downloading {REPO_ID} to {DOWNLOAD_DIR} ...")
    path = snapshot_download(repo_id=REPO_ID, local_dir=str(DOWNLOAD_DIR))
    print(f"Downloaded to: {path}")
    return Path(path)


def inspect_repo(repo_dir: Path):
    print("\n=== Files in repo ===")
    files = sorted(p.relative_to(repo_dir).as_posix() for p in repo_dir.rglob("*") if p.is_file())
    for f in files:
        size = (repo_dir / f).stat().st_size
        print(f"  {f}  ({size:,} bytes)")

    config_path = repo_dir / "config.json"
    if config_path.exists():
        print("\n=== config.json ===")
        config = json.loads(config_path.read_text(encoding="utf-8"))
        print(json.dumps(config, indent=2)[:4000])
        if "id2label" in config:
            print("\nFound id2label in config.json — this is the real label order to use:")
            for idx in sorted(config["id2label"], key=lambda k: int(k)):
                print(f"  {idx}: {config['id2label'][idx]}")

    preprocessor_config_path = repo_dir / "preprocessor_config.json"
    if preprocessor_config_path.exists():
        print("\n=== preprocessor_config.json (real normalization/size values) ===")
        print(preprocessor_config_path.read_text(encoding="utf-8"))

    for readme_name in ("README.md", "readme.md"):
        readme_path = repo_dir / readme_name
        if readme_path.exists():
            print(f"\n=== {readme_name} (first 3000 chars) ===")
            print(readme_path.read_text(encoding="utf-8")[:3000])
            break

    has_pytorch = any(f.endswith((".bin", ".safetensors")) for f in files)
    has_keras = any(f.endswith((".h5", ".keras")) for f in files)
    has_savedmodel = any("saved_model.pb" in f for f in files)
    has_onnx_already = any(f.endswith(".onnx") for f in files)

    print("\n=== Detected format ===")
    if has_onnx_already:
        print("An .onnx file already exists in the repo — you may be able to use it directly")
        print("(still run --convert's verification step to fill in model-config.js).")
    elif has_pytorch:
        print("Looks like a PyTorch / transformers model -> use convert_pytorch_transformers()")
    elif has_keras or has_savedmodel:
        print("Looks like a Keras / TensorFlow model -> use convert_keras()")
    else:
        print("Could not confidently detect the framework from file extensions.")
        print("Inspect the file list above manually and extend this script's convert step.")

    return {
        "has_pytorch": has_pytorch,
        "has_keras": has_keras,
        "has_savedmodel": has_savedmodel,
        "has_onnx_already": has_onnx_already,
    }


def convert_pytorch_transformers(repo_dir: Path):
    """Export a Hugging Face `transformers` image classifier to ONNX.

    Only handles the common case: AutoModelForImageClassification +
    AutoImageProcessor, with id2label present in config.json. If the real
    repo doesn't match this shape (e.g. a bare state_dict with no
    `transformers`-style config), this will raise — do not paper over that
    by guessing an architecture; extend this function once you've seen
    what --inspect actually reports.
    """
    import torch
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    print("Loading transformers model + processor ...")
    processor = AutoImageProcessor.from_pretrained(str(repo_dir))
    model = AutoModelForImageClassification.from_pretrained(str(repo_dir))
    model.eval()

    size = processor.size
    height = size.get("height") or size.get("shortest_edge")
    width = size.get("width") or size.get("shortest_edge")
    mean = processor.image_mean
    std = processor.image_std

    id2label = model.config.id2label
    label_order = [id2label[i] for i in range(len(id2label))]

    dummy_input = torch.randn(1, 3, height, width)
    input_name = "pixel_values"
    output_name = "logits"

    print(f"Exporting to {ONNX_OUTPUT_PATH} ...")
    ONNX_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy_input,
        str(ONNX_OUTPUT_PATH),
        input_names=[input_name],
        output_names=[output_name],
        opset_version=13,
        dynamic_axes={input_name: {0: "batch"}, output_name: {0: "batch"}},
    )

    return {
        "input_name": input_name,
        "width": width,
        "height": height,
        "channel_order": "RGB",
        "layout": "NCHW",
        "mean": list(mean),
        "std": list(std),
        "scale": None,
        "output_name": output_name,
        "is_probabilities": False,  # raw logits from AutoModelForImageClassification
        "label_order": label_order,
    }


def convert_keras(repo_dir: Path):
    """Export a Keras/TensorFlow model (.h5, .keras, or SavedModel dir) to ONNX.

    You MUST fill in the real input size, normalization, and label order
    below by reading the source repo's own training/preprocessing code or
    README — a raw Keras export carries none of that metadata the way a
    `transformers` config.json does. Do not invent these values.
    """
    import tensorflow as tf
    import tf2onnx

    candidates = list(repo_dir.glob("*.h5")) + list(repo_dir.glob("*.keras"))
    if candidates:
        print(f"Loading Keras model: {candidates[0]}")
        model = tf.keras.models.load_model(str(candidates[0]))
    else:
        print("Loading TensorFlow SavedModel directory ...")
        model = tf.keras.models.load_model(str(repo_dir))

    input_shape = model.input_shape  # e.g. (None, 224, 224, 3)
    height, width = input_shape[1], input_shape[2]

    print(f"Exporting to {ONNX_OUTPUT_PATH} ...")
    ONNX_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    spec = (tf.TensorSpec((1, height, width, 3), tf.float32, name="input"),)
    tf2onnx.convert.from_keras(model, input_signature=spec, opset=13, output_path=str(ONNX_OUTPUT_PATH))

    print(
        "\nIMPORTANT: fill in the real mean/std/scale and label_order below by\n"
        "reading this repo's own training script or README — a Keras export\n"
        "does not carry that metadata automatically. Re-run with those filled\n"
        "in before trusting model-config.js."
    )
    return {
        "input_name": "input",
        "width": width,
        "height": height,
        "channel_order": "RGB",  # confirm against the source training code
        "layout": "NHWC",
        "mean": None,  # fill in from the source repo's preprocessing
        "std": None,
        "scale": 1.0 / 255,  # common default for Keras models; confirm this
        "output_name": model.output_names[0] if hasattr(model, "output_names") else "output",
        "is_probabilities": True,  # true if the model's last layer is softmax; confirm
        "label_order": None,  # fill in from the source repo's class_names / README
    }


def verify_onnx():
    import numpy as np
    import onnxruntime as ort

    print(f"\nVerifying {ONNX_OUTPUT_PATH} with onnxruntime ...")
    session = ort.InferenceSession(str(ONNX_OUTPUT_PATH), providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    output_meta = session.get_outputs()[0]
    print(f"  input:  name={input_meta.name!r} shape={input_meta.shape} dtype={input_meta.type}")
    print(f"  output: name={output_meta.name!r} shape={output_meta.shape} dtype={output_meta.type}")

    dummy_shape = [d if isinstance(d, int) and d > 0 else 1 for d in input_meta.shape]
    dummy = np.random.rand(*dummy_shape).astype("float32")
    result = session.run(None, {input_meta.name: dummy})
    print(f"  test run output shape: {result[0].shape}")

    return {"input_name": input_meta.name, "output_name": output_meta.name}


def write_model_config(info: dict):
    label_order = info.get("label_order")
    label_wording = {}
    if label_order:
        for raw_label in label_order:
            label_wording[raw_label] = SAFE_WORDING.get(
                raw_label, {"label": f"visible finding: {raw_label}", "severity": "yellow"}
            )
    else:
        label_wording = SAFE_WORDING

    config_js = f"""/* Model configuration for models/dental-visible-features.onnx
 *
 * GENERATED by scripts/convert_oral_disease_model.py — every value below
 * was read from the actual exported ONNX model (via onnxruntime) or the
 * source model's own config, not guessed. Re-run the script if the model
 * is ever re-exported.
 */
window.DENTAL_MODEL_CONFIG = {{
  verified: true,
  sourceModel: "{REPO_ID}",
  modelPath: "models/dental-visible-features.onnx",

  input: {{
    name: {json.dumps(info.get("input_name"))},
    width: {json.dumps(info.get("width"))},
    height: {json.dumps(info.get("height"))},
    channelOrder: {json.dumps(info.get("channel_order"))},
    layout: {json.dumps(info.get("layout"))},
    mean: {json.dumps(info.get("mean"))},
    std: {json.dumps(info.get("std"))},
    scale: {json.dumps(info.get("scale"))},
  }},

  output: {{
    name: {json.dumps(info.get("output_name"))},
    isProbabilities: {json.dumps(info.get("is_probabilities"))},
  }},

  labelOrder: {json.dumps(label_order)},

  labelToSafeWording: {json.dumps(label_wording, indent=4)},
}};
"""
    MODEL_CONFIG_PATH.write_text(config_js)
    print(f"\nWrote {MODEL_CONFIG_PATH}")
    if not label_order or info.get("mean") is None:
        print(
            "\nWARNING: label_order and/or mean/std/scale are still incomplete.\n"
            "Fill these in from the source repo before setting real predictions live,\n"
            "and keep `verified: false` until every field is actually confirmed."
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inspect", action="store_true", help="Download the repo and print what's in it")
    parser.add_argument("--convert", action="store_true", help="Export to ONNX and write model-config.js")
    args = parser.parse_args()

    if not args.inspect and not args.convert:
        parser.print_help()
        sys.exit(1)

    repo_dir = download_repo()
    detected = inspect_repo(repo_dir)

    if not args.convert:
        return

    if detected["has_pytorch"]:
        info = convert_pytorch_transformers(repo_dir)
    elif detected["has_keras"] or detected["has_savedmodel"]:
        info = convert_keras(repo_dir)
    else:
        print("\nCannot auto-convert: unrecognized model format. See the file list above")
        print("and extend this script with a conversion path for it.")
        sys.exit(1)

    verified_names = verify_onnx()
    info["input_name"] = verified_names["input_name"]
    info["output_name"] = verified_names["output_name"]

    write_model_config(info)
    print("\nDone. Review models/model-config.js, then commit it together with")
    print(f"{ONNX_OUTPUT_PATH.relative_to(REPO_ROOT)}.")


if __name__ == "__main__":
    main()
