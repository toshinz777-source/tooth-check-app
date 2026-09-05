/* Dental AI (Experimental) — on-device dental photo analysis.
 *
 * Everything here runs locally in the browser via ONNX Runtime Web. No
 * photo, image data, or model output is ever sent to a server, logged, or
 * used for analytics.
 *
 * Target model: "nsr51324/Oral_Diseases_Image_Classification" (Hugging
 * Face) — see models/README.md for status. This app's build environment
 * could not reach huggingface.co to download/inspect/convert it, so no
 * model file is shipped and no metadata is guessed. Every function here
 * degrades to a safe "unavailable" result instead of throwing or
 * fabricating a prediction when the model isn't present.
 *
 * Preprocessing, output shape, and label wording are read from
 * models/model-config.js when it reports `verified: true` (meaning those
 * values were actually confirmed against a real exported model — see
 * scripts/convert_oral_disease_model.py). Until then, this module falls
 * back to its own generic, already-tested placeholder category list, so
 * today's app behavior is unchanged.
 *
 * The AI never diagnoses a condition. It can only report visible features
 * (e.g. "visible dark/caries-like area") with a confidence score, for
 * combineAIWithQuestionnaire() to weigh alongside the questionnaire.
 */

const DentalAI = (function () {
  const ORT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js";
  const DEFAULT_MODEL_URL = "models/dental-visible-features.onnx";
  const DEFAULT_INPUT_SIZE = 224;

  const CONFIDENCE_THRESHOLD = 0.5; // below this, a finding is not treated as positive
  const UNCERTAIN_MARGIN = 0.15; // top two scores this close => uncertain
  const SEVERITY_ORDER = ["green", "yellow", "red", "emergency"];
  const EXPERIMENTAL_DISCLAIMER = "Experimental AI finding — not a diagnosis.";

  // ---- Default (unverified-model) category set — unchanged from before ----
  const DEFAULT_CATEGORIES = [
    {
      rawLabel: "visible dark area",
      label: "visible dark area",
      severity: "yellow",
      explanation:
        "A dark area is visible in the photo. This can have several causes and should be checked by a dentist if symptoms persist.",
    },
    {
      rawLabel: "visible tooth damage or chip",
      label: "visible tooth damage or chip",
      severity: "yellow",
      explanation:
        "The photo shows what may be damage or a chip on the tooth surface. A dentist can confirm whether treatment is needed.",
    },
    {
      rawLabel: "visible crack-like feature",
      label: "visible crack-like feature",
      severity: "yellow",
      explanation:
        "A crack-like line is visible on the tooth. This should be evaluated by a dentist, especially if biting causes pain.",
    },
    {
      rawLabel: "visible gum redness",
      label: "visible gum redness",
      severity: "red",
      explanation: "The gum tissue looks redder than usual in this photo. This can be worth mentioning at a dental visit.",
    },
    {
      rawLabel: "visible gum swelling",
      label: "visible gum swelling",
      severity: "yellow",
      explanation: "The gum tissue appears swollen in this photo. If this persists or grows, a dental check is recommended.",
    },
    {
      rawLabel: "visible bleeding",
      label: "visible bleeding",
      severity: "red",
      explanation:
        "The photo shows what may be bleeding near the gum or tooth. This is worth discussing with a dentist, especially if it recurs.",
    },
    {
      rawLabel: "visible discharge-like area",
      label: "visible discharge-like area",
      severity: "red",
      explanation: "An area that may be discharge is visible in the photo. This should be assessed by a dentist promptly.",
    },
    {
      rawLabel: "visible facial swelling",
      label: "visible facial swelling",
      severity: "red",
      explanation: "The photo shows what may be facial swelling. If this is spreading or you feel unwell, seek prompt care.",
    },
    {
      rawLabel: "obvious trauma",
      label: "obvious trauma",
      severity: "red",
      explanation: "The photo shows signs that may indicate trauma or injury. A dentist should assess this as soon as possible.",
    },
    {
      rawLabel: "no obvious visible abnormality",
      label: "no obvious visible abnormality",
      severity: "green",
      explanation:
        "No obvious visible abnormality was detected in this photo. Many dental problems cannot be detected from a smartphone photo.",
    },
  ];

  function genericExplanation(label) {
    return `"${label}" was flagged by the on-device AI. This is not a diagnosis — it should be checked by a dentist, especially if it persists.`;
  }

  /** Resolves the active category set + model settings from model-config.js, or the built-in defaults. */
  function resolveConfig() {
    const cfg = window.DENTAL_MODEL_CONFIG;
    if (!cfg || !cfg.verified || !Array.isArray(cfg.labelOrder) || !cfg.labelOrder.length) {
      return {
        verified: false,
        sourceModel: (cfg && cfg.sourceModel) || null,
        modelUrl: DEFAULT_MODEL_URL,
        inputWidth: DEFAULT_INPUT_SIZE,
        inputHeight: DEFAULT_INPUT_SIZE,
        channelOrder: "RGB",
        layout: "NCHW",
        mean: null,
        std: null,
        scale: 1 / 255,
        outputIsProbabilities: null, // auto-detect
        categories: DEFAULT_CATEGORIES,
      };
    }

    const categories = cfg.labelOrder.map((rawLabel) => {
      const entry = (cfg.labelToSafeWording && cfg.labelToSafeWording[rawLabel]) || {
        label: rawLabel,
        severity: "yellow",
      };
      return {
        rawLabel,
        label: entry.label,
        severity: entry.severity || "yellow",
        explanation: genericExplanation(entry.label),
      };
    });

    return {
      verified: true,
      sourceModel: cfg.sourceModel || null,
      modelUrl: cfg.modelPath || DEFAULT_MODEL_URL,
      inputWidth: cfg.input.width || DEFAULT_INPUT_SIZE,
      inputHeight: cfg.input.height || DEFAULT_INPUT_SIZE,
      channelOrder: cfg.input.channelOrder || "RGB",
      layout: cfg.input.layout || "NCHW",
      mean: cfg.input.mean || null,
      std: cfg.input.std || null,
      scale: cfg.input.scale !== null && cfg.input.scale !== undefined ? cfg.input.scale : 1 / 255,
      outputIsProbabilities: cfg.output.isProbabilities !== undefined ? cfg.output.isProbabilities : null,
      categories,
    };
  }

  const ACTIVE = resolveConfig();
  const CATEGORY_BY_LABEL = new Map(ACTIVE.categories.map((c) => [c.label, c]));
  const CATEGORIES = ACTIVE.categories.map((c) => c.label);
  const CATEGORY_EXPLANATIONS = Object.fromEntries(ACTIVE.categories.map((c) => [c.label, c.explanation]));

  let session = null;
  let backend = null; // 'webgpu' | 'wasm' | null
  let ortLoadPromise = null;
  let modelAvailability = null; // cached { exists } result

  function maxSeverity(a, b) {
    return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
  }

  /** UI confidence tier — display only, not a clinical threshold. */
  function confidenceTier(confidence) {
    if (confidence < 0.5) return "none";
    if (confidence < 0.7) return "low";
    if (confidence < 0.85) return "moderate";
    return "high";
  }

  function loadOrtRuntime() {
    if (window.ort) return Promise.resolve();
    if (ortLoadPromise) return ortLoadPromise;

    ortLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ORT_SCRIPT_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load ONNX Runtime Web"));
      document.head.appendChild(script);
    });

    return ortLoadPromise;
  }

  /** Cheap existence check for the model file, without loading the runtime. */
  async function checkModelAvailability() {
    if (modelAvailability) return modelAvailability;
    try {
      const res = await fetch(ACTIVE.modelUrl, { method: "HEAD" });
      modelAvailability = { exists: res.ok };
    } catch {
      modelAvailability = { exists: false };
    }
    return modelAvailability;
  }

  /**
   * Loads ONNX Runtime Web and creates an inference session, preferring
   * WebGPU and automatically falling back to WebAssembly. Never throws —
   * returns { available: false, reason } instead so the app can always
   * fall back to the manual checklist.
   */
  async function initializeDentalModel() {
    if (session) return { available: true, backend, reason: null };

    const availability = await checkModelAvailability();
    if (!availability.exists) {
      return { available: false, backend: null, reason: "model-missing" };
    }

    try {
      await loadOrtRuntime();
    } catch {
      return { available: false, backend: null, reason: "runtime-unavailable" };
    }

    if (!window.ort) {
      return { available: false, backend: null, reason: "runtime-unavailable" };
    }

    const providers = [];
    if (typeof navigator !== "undefined" && navigator.gpu) providers.push("webgpu");
    providers.push("wasm");

    for (const provider of providers) {
      try {
        session = await window.ort.InferenceSession.create(ACTIVE.modelUrl, {
          executionProviders: [provider],
        });
        backend = provider;
        return { available: true, backend, reason: null };
      } catch {
        // Try the next execution provider.
      }
    }

    return { available: false, backend: null, reason: "session-failed" };
  }

  /**
   * Heuristic only — NOT real subject detection. Compares contrast in a
   * center crop against the full frame as a rough proxy for "is there a
   * distinct subject filling the frame, or mostly blank background."
   */
  function estimateCenterContrast(grayscale, width, height) {
    const cx0 = Math.floor(width * 0.2);
    const cx1 = Math.ceil(width * 0.8);
    const cy0 = Math.floor(height * 0.2);
    const cy1 = Math.ceil(height * 0.8);

    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = cy0; y < cy1; y += 2) {
      for (let x = cx0; x < cx1; x += 2) {
        const v = grayscale[y * width + x];
        sum += v;
        sumSq += v * v;
        n++;
      }
    }
    if (n === 0) return 0;
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return Math.sqrt(Math.max(variance, 0));
  }

  /**
   * Checks brightness, blur, resolution, and (heuristically) whether the
   * frame contains a distinct subject, on the full-size photo canvas. AI
   * analysis must not run on a photo that fails this gate.
   */
  function calculateImageQuality(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const reasons = [];

    if (width < 200 || height < 200) {
      reasons.push("Resolution is too low");
    }

    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, width, height);

    const pixelCount = width * height;
    const grayscale = new Float32Array(pixelCount);
    let brightnessSum = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      grayscale[p] = gray;
      brightnessSum += gray;
    }
    const brightness = brightnessSum / pixelCount;

    if (brightness < 40) reasons.push("Image is too dark");
    if (brightness > 235) reasons.push("Image is overexposed");

    // Lightweight blur estimate: average gradient magnitude, sampled on a
    // stride to stay fast on phone-sized photos.
    let gradientSum = 0;
    let gradientCount = 0;
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const idx = y * width + x;
        const gx = grayscale[idx + 1] - grayscale[idx - 1];
        const gy = grayscale[idx + width] - grayscale[idx - width];
        gradientSum += Math.abs(gx) + Math.abs(gy);
        gradientCount++;
      }
    }
    const blurScore = gradientCount ? gradientSum / gradientCount : 0;
    if (blurScore < 8) reasons.push("Image appears blurry or out of focus");

    const centerContrast = estimateCenterContrast(grayscale, width, height);
    if (centerContrast < 10) {
      reasons.push("The tooth or mouth area may not fill enough of the frame");
    }

    return {
      brightness,
      blurScore,
      centerContrast,
      width,
      height,
      overallOk: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Resizes the photo to the model's expected input and returns an
   * ort.Tensor matching the active config's layout, channel order, and
   * normalization. Uses a throwaway canvas so the full-resolution photo
   * buffer isn't duplicated any longer than needed.
   */
  function preprocessDentalImage(canvas) {
    const w = ACTIVE.inputWidth;
    const h = ACTIVE.inputHeight;

    const resized = document.createElement("canvas");
    resized.width = w;
    resized.height = h;
    const ctx = resized.getContext("2d");
    ctx.drawImage(canvas, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const plane = w * h;
    const out = new Float32Array(3 * plane);

    const normalize = (value, channelIndex) => {
      let v = value / 255;
      if (ACTIVE.mean && ACTIVE.std) {
        v = (v - ACTIVE.mean[channelIndex]) / ACTIVE.std[channelIndex];
      } else if (ACTIVE.scale !== null && ACTIVE.scale !== undefined) {
        v = value * ACTIVE.scale;
      }
      return v;
    };

    const bgr = ACTIVE.channelOrder === "BGR";
    for (let p = 0; p < plane; p++) {
      const r = data[p * 4];
      const g = data[p * 4 + 1];
      const b = data[p * 4 + 2];
      const c0 = bgr ? b : r;
      const c2 = bgr ? r : b;

      if (ACTIVE.layout === "NHWC") {
        out[p * 3] = normalize(c0, 0);
        out[p * 3 + 1] = normalize(g, 1);
        out[p * 3 + 2] = normalize(c2, 2);
      } else {
        out[p] = normalize(c0, 0);
        out[plane + p] = normalize(g, 1);
        out[plane * 2 + p] = normalize(c2, 2);
      }
    }

    resized.width = 0;
    resized.height = 0;

    const dims = ACTIVE.layout === "NHWC" ? [1, h, w, 3] : [1, 3, h, w];
    return new window.ort.Tensor("float32", out, dims);
  }

  function softmax(values) {
    const max = Math.max(...values);
    const exps = values.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum);
  }

  /**
   * Converts the raw model output tensor into labeled, sorted
   * {category, confidence, tier} findings, and flags the result as
   * uncertain when confidence is low or the top two categories are too
   * close to call.
   */
  function interpretModelOutput(outputTensor) {
    const raw = Array.from(outputTensor.data);
    const looksNormalized =
      raw.every((v) => v >= 0 && v <= 1) && Math.abs(raw.reduce((a, b) => a + b, 0) - 1) < 0.05;
    const isProbabilities = ACTIVE.outputIsProbabilities !== null ? ACTIVE.outputIsProbabilities : looksNormalized;
    const probs = isProbabilities ? raw : softmax(raw);

    const findings = CATEGORIES.map((category, i) => ({
      category,
      confidence: probs[i] || 0,
      tier: confidenceTier(probs[i] || 0),
    })).sort((a, b) => b.confidence - a.confidence);

    const [top, second] = findings;
    const invalidOutput = !top || findings.some((f) => Number.isNaN(f.confidence));
    const uncertain =
      invalidOutput ||
      top.confidence < CONFIDENCE_THRESHOLD ||
      (second && top.confidence - second.confidence < UNCERTAIN_MARGIN);

    return { findings, uncertain };
  }

  /**
   * Full pipeline: quality gate -> model availability -> preprocess ->
   * inference -> interpret. Always resolves (never rejects) with a
   * `status` field describing what happened, so the caller can render a
   * safe message instead of crashing.
   */
  async function analyzeDentalImage(canvas) {
    const quality = calculateImageQuality(canvas);
    if (!quality.overallOk) {
      return { status: "poor-quality", quality };
    }

    const init = await initializeDentalModel();
    if (!init.available) {
      return { status: "unavailable", reason: init.reason, quality };
    }

    let tensor = null;
    try {
      tensor = preprocessDentalImage(canvas);
      const feeds = { [session.inputNames[0]]: tensor };
      const results = await session.run(feeds);
      const outputTensor = results[session.outputNames[0]];
      const { findings, uncertain } = interpretModelOutput(outputTensor);

      return {
        status: "ok",
        backend,
        quality,
        findings,
        uncertain,
        sourceModel: ACTIVE.sourceModel,
        verifiedModel: ACTIVE.verified,
      };
    } catch {
      return { status: "error", quality };
    } finally {
      disposeImageData(tensor);
    }
  }

  /** Releases tensor/image buffers so they don't linger in memory. */
  function disposeImageData(tensor) {
    if (tensor && typeof tensor.dispose === "function") {
      tensor.dispose();
    }
  }

  /**
   * Folds a confident AI result into an urgency tier (green/yellow/red)
   * and returns whichever is more severe: that tier, or the
   * questionnaire's own tier. An unavailable, errored, poor-quality, or
   * uncertain AI result never changes the questionnaire's tier.
   */
  function combineAIWithQuestionnaire(aiResult, questionnaireLevel) {
    const baseLevel = questionnaireLevel || "green";
    if (!aiResult || aiResult.status !== "ok" || aiResult.uncertain) {
      return baseLevel;
    }

    let aiLevel = "green";
    for (const finding of aiResult.findings) {
      if (finding.confidence < CONFIDENCE_THRESHOLD) continue;
      const meta = CATEGORY_BY_LABEL.get(finding.category);
      if (meta && meta.severity) aiLevel = maxSeverity(aiLevel, meta.severity);
    }

    return maxSeverity(aiLevel, baseLevel);
  }

  /**
   * Emergency red flags from the questionnaire alone. These always
   * override the AI result and the rest of the questionnaire — the photo
   * AI can never suppress or replace an emergency.
   */
  function detectEmergencyRedFlags(questionnaire) {
    const flags = [];
    if (questionnaire.swallowBreath === "Yes") {
      flags.push("Difficulty swallowing or breathing");
    }
    if (questionnaire.fever === "Yes" && questionnaire.swelling === "Yes") {
      flags.push("Fever with facial or dental swelling");
    }
    if (questionnaire.painScore >= 9 && questionnaire.duration === "Constant pain") {
      flags.push("Severe uncontrolled pain");
    }
    return flags;
  }

  /**
   * Self-contained questionnaire + AI combiner (usable independently of
   * app.js, e.g. for testing). Red flags always win; otherwise the more
   * severe of the questionnaire-only tier and the AI-informed tier wins.
   */
  function calculateCombinedUrgency(questionnaire, aiResult) {
    const redFlags = detectEmergencyRedFlags(questionnaire);
    if (redFlags.length > 0) {
      return {
        level: "emergency",
        title: "Seek urgent medical or dental care now",
        redFlags,
        aiConsidered: false,
      };
    }

    const questionnaireLevel =
      typeof window.computeQuestionnaireUrgency === "function"
        ? window.computeQuestionnaireUrgency(questionnaire, [])
        : "green";

    const level = combineAIWithQuestionnaire(aiResult, questionnaireLevel);
    const aiConsidered = Boolean(aiResult && aiResult.status === "ok" && !aiResult.uncertain);

    const titles = {
      green: "Low urgency",
      yellow: "Book a dentist soon",
      red: "Urgent dental assessment",
    };

    return { level, title: titles[level], redFlags: [], aiConsidered };
  }

  return {
    initializeDentalModel,
    checkModelAvailability,
    preprocessDentalImage,
    analyzeDentalImage,
    calculateImageQuality,
    interpretModelOutput,
    combineAIWithQuestionnaire,
    calculateCombinedUrgency,
    disposeImageData,
    confidenceTier,
    CATEGORIES,
    CATEGORY_EXPLANATIONS,
    CONFIDENCE_THRESHOLD,
    EXPERIMENTAL_DISCLAIMER,
    MODEL_STATUS: { verified: ACTIVE.verified, sourceModel: ACTIVE.sourceModel },
  };
})();

window.DentalAI = DentalAI;
