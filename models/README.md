# Dental AI model (not included)

This app's on-device AI Photo Analysis feature (`js/dental-ai.js`) looks for
a model file here:

```
models/dental-visible-features.onnx
```

**No model is currently included.**

## Target model and current status

The intended model is the public research/educational classifier
[`nsr51324/Oral_Diseases_Image_Classification`](https://huggingface.co/nsr51324/Oral_Diseases_Image_Classification)
on Hugging Face. This is **not a medically validated clinical diagnostic
model** — its outputs are only ever treated as experimental, non-diagnostic
visible-feature classification (see the safety notes in `js/dental-ai.js`
and the main README).

**Integration is blocked on network access.** The environment this feature
was built in could not reach `huggingface.co` (blocked by network egress
policy — confirmed via direct HTTPS requests and the fetch tool, both
returned an explicit policy rejection, not a transient failure). Because of
that, the model could not be downloaded, inspected, or converted here — and
per this project's own rule, no fake model file or fabricated prediction
was created to paper over that gap. Instead:

- `scripts/convert_oral_disease_model.py` — downloads the real model,
  prints its actual contents (`--inspect`), and exports + verifies it to
  ONNX (`--convert`), writing real (not guessed) values into
  `model-config.js`. Run it on any machine with normal internet access.
- `models/model-config.js` — currently an **unverified template**
  (`verified: false`) with the app's *intended* label wording, based on the
  class names on the source model's card. Every numeric/structural field
  (input size, normalization, real label order, output shape) is `null`
  until the script above actually confirms it — `js/dental-ai.js` reads
  this file and only trusts it once `verified: true`.
- Until then, `js/dental-ai.js` runs its own generic, already-tested
  placeholder category list (unchanged app behavior), and the AI panel
  correctly shows "Experimental — dental-specific AI model not yet
  installed" rather than a fabricated result. This was verified with a
  throwaway, non-shipped test ONNX model exercising the full pipeline,
  including a run with `verified: true` and the real label set below to
  confirm the config-driven path works end-to-end.

## To finish this integration

1. On a machine with access to huggingface.co:
   ```
   pip install huggingface_hub onnx onnxruntime numpy pillow
   python scripts/convert_oral_disease_model.py --inspect
   ```
   Read the output — it tells you the actual framework (PyTorch/transformers
   vs. Keras/TensorFlow) and prints the real `config.json` / label order.
2. Install the matching extra dependency (`torch transformers`, or
   `tensorflow tf2onnx`) and run:
   ```
   python scripts/convert_oral_disease_model.py --convert
   ```
   This exports `models/dental-visible-features.onnx`, verifies it with
   `onnxruntime`, and rewrites `models/model-config.js` with the real
   values it found.
3. Review the rewritten `model-config.js`: confirm `labelOrder` matches the
   source model's classes, and that `labelToSafeWording` covers every one
   of them with non-diagnostic phrasing (extend `SAFE_WORDING` in the
   script, or edit the file directly, for any class not already mapped).
   Only leave `verified: true` once you've checked this by hand.
4. Serve the app locally and try the Photo Check step with a few real
   photos to sanity-check the output before committing.
5. Commit both `models/dental-visible-features.onnx` and the regenerated
   `models/model-config.js` together.

## Model contract `js/dental-ai.js` expects

- **Input**: tensor named per `model-config.js`'s `input.name` (verified
  from the export), shape `[1, 3, H, W]` (or `[1, H, W, 3]` if
  `layout: "NHWC"`), `float32`, RGB or BGR per `channelOrder`, normalized
  per `mean`/`std` or a flat `scale`.
- **Output**: tensor named per `output.name`, shape `[1, N]` matching
  `labelOrder`'s length, raw logits or softmax probabilities per
  `isProbabilities`.

These are **visible-feature categories, not diagnoses**. Do not train or
label a model against disease names shown directly to users (cavity,
abscess, gum disease, cancer, etc.) — map every raw class to the
non-diagnostic wording pattern already used in `model-config.js` and
`js/dental-ai.js` (e.g. "visible dark/caries-like area", never "cavity").

Any dental-specific model added here should be validated (e.g. against a
held-out clinical dataset with appropriate regulatory/ethical review) before
being presented to real users as anything more than experimental.
