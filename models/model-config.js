/* Model configuration for models/dental-visible-features.onnx
 *
 * STATUS: UNVERIFIED TEMPLATE. No model file is present in this repo, and
 * none of the values below have been confirmed against a real model.
 *
 * Target model: "nsr51324/Oral_Diseases_Image_Classification" (Hugging
 * Face) — a public research/educational oral disease image classifier.
 * This app's build environment could not reach huggingface.co (blocked by
 * network egress policy), so the model could not be downloaded, inspected,
 * or converted here. See models/README.md and scripts/convert_oral_disease_model.py
 * for the exact steps to finish this on a machine with network access.
 *
 * js/dental-ai.js reads this file at load time:
 *   - If `verified` is false (or this file / the .onnx file is missing),
 *     it falls back to its own generic, already-tested placeholder
 *     category list — current, unchanged app behavior.
 *   - If `verified` is true, it uses the fields below as the source of
 *     truth for preprocessing, output interpretation, and label wording.
 *
 * IMPORTANT: every field below must come from actually running
 * scripts/convert_oral_disease_model.py --inspect / --convert against the
 * real model (which prints and writes back the real values it finds) —
 * never from guessing what "looks right". Flip `verified` to true only
 * once every null below has been replaced with a value confirmed that way.
 */
window.DENTAL_MODEL_CONFIG = {
  verified: false,
  sourceModel: "nsr51324/Oral_Diseases_Image_Classification",
  modelPath: "models/dental-visible-features.onnx",

  input: {
    // Name of the model's input tensor (session.inputNames[0] once exported).
    name: null,
    width: null,
    height: null,
    // "RGB" or "BGR" — must match how the source model was trained.
    channelOrder: null,
    // "NCHW" or "NHWC".
    layout: null,
    // Per-channel normalization. Use EITHER mean/std (e.g. ImageNet-style
    // [0.485,0.456,0.406] / [0.229,0.224,0.225] applied to 0-1 pixels) OR
    // a flat `scale` (e.g. 1/255 with no mean/std) — whichever the source
    // model's preprocessing actually uses. Leave the unused one null.
    mean: null,
    std: null,
    scale: null,
  },

  output: {
    // Name of the model's output tensor (session.outputNames[0]).
    name: null,
    // true if the model already applies softmax internally (outputs sum
    // to ~1); false if it outputs raw logits that dental-ai.js must
    // soften itself.
    isProbabilities: null,
  },

  // Real label order the model was trained with, e.g. the `id2label` map
  // from the source model's config.json, in output-index order. Must be
  // verified — do not assume this matches labelToSafeWording's key order.
  labelOrder: null,

  // Maps each raw model label to non-diagnostic UI wording and a rough
  // urgency tier (green/yellow/red) for calculateCombinedUrgency(). The
  // wording and tiers below reflect the app's intended mapping for this
  // model's known class set (per the source model card), but are not yet
  // wired up (labelOrder is null / verified is false) and the tiers are
  // this app's own conservative editorial judgment, not a clinical
  // severity scale.
  labelToSafeWording: {
    Caries: { label: "visible dark/caries-like area", severity: "yellow" },
    Calculus: { label: "visible calculus/tartar-like buildup", severity: "yellow" },
    Gingivitis: { label: "visible gum inflammation-like appearance", severity: "yellow" },
    Ulcer: { label: "visible ulcer-like area", severity: "yellow" },
    Discoloration: { label: "visible discoloration", severity: "yellow" },
    Hypodontia: { label: "visible missing-tooth pattern", severity: "yellow" },
  },
};
