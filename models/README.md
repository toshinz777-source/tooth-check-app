# Dental AI model (not included)

This app's on-device AI Photo Analysis feature (`js/dental-ai.js`) looks for
a model file here:

```
models/dental-visible-features.onnx
```

**No model is currently included.** There is no medically validated,
dental-specific model shipped with this app, so the feature runs in
"Experimental — dental-specific AI model not yet installed" mode: the full
ONNX Runtime Web pipeline (WebGPU-with-WASM-fallback, image quality gate,
preprocessing, inference, confidence scoring) is implemented and ready, but
it never fabricates a prediction when no model file is present.

## Expected model contract

If you add a model here, it must match what `js/dental-ai.js` expects:

- **Input**: a single tensor named anything (the code reads
  `session.inputNames[0]`), shape `[1, 3, 224, 224]`, `float32`, NCHW layout,
  pixel values normalized to `0-1`.
- **Output**: a single tensor named anything (the code reads
  `session.outputNames[0]`), shape `[1, 10]`, either raw logits or
  softmax-normalized probabilities, in this exact category order:

  1. visible dark area
  2. visible tooth damage or chip
  3. visible crack-like feature
  4. visible gum redness
  5. visible gum swelling
  6. visible bleeding
  7. visible discharge-like area
  8. visible facial swelling
  9. obvious trauma
  10. no obvious visible abnormality

These are **visible-feature categories, not diagnoses**. Do not train or
label a model against disease names (cavity, abscess, gum disease, cancer,
etc.) — see the safety notes at the top of `js/dental-ai.js` and in the main
README before adding a model here.

Any dental-specific model added here should be validated (e.g. against a
held-out clinical dataset with appropriate regulatory/ethical review) before
being presented to real users as anything more than experimental.
