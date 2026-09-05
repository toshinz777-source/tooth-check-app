/* Dental AI (Experimental) — on-device dental photo analysis.
 *
 * Everything here runs locally in the browser via ONNX Runtime Web. No
 * photo, image data, or model output is ever sent to a server, logged, or
 * used for analytics. If `models/dental-visible-features.onnx` is not
 * present, every function degrades to a safe "unavailable" result instead
 * of throwing or fabricating a prediction — there is currently no
 * medically validated dental model shipped with this app.
 *
 * The AI never diagnoses a condition. It can only report visible features
 * (e.g. "visible dark area") with a confidence score, for
 * combineAIWithQuestionnaire() to weigh alongside the questionnaire.
 */

const DentalAI = (function () {
  const MODEL_URL = "models/dental-visible-features.onnx";
  const ORT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js";
  const INPUT_SIZE = 224; // model input: 1x3x224x224, float32, 0-1 range

  const CONFIDENCE_THRESHOLD = 0.5;
  const UNCERTAIN_MARGIN = 0.15;
  const SEVERITY_ORDER = ["green", "yellow", "red", "emergency"];

  // Visible-feature categories only. Never a disease name.
  const CATEGORIES = [
    "visible dark area",
    "visible tooth damage or chip",
    "visible crack-like feature",
    "visible gum redness",
    "visible gum swelling",
    "visible bleeding",
    "visible discharge-like area",
    "visible facial swelling",
    "obvious trauma",
    "no obvious visible abnormality",
  ];

  // Safe, non-diagnostic explanation shown for whichever category is on top.
  const CATEGORY_EXPLANATIONS = {
    "visible dark area":
      "A dark area is visible in the photo. This can have several causes and should be checked by a dentist if symptoms persist.",
    "visible tooth damage or chip":
      "The photo shows what may be damage or a chip on the tooth surface. A dentist can confirm whether treatment is needed.",
    "visible crack-like feature":
      "A crack-like line is visible on the tooth. This should be evaluated by a dentist, especially if biting causes pain.",
    "visible gum redness":
      "The gum tissue looks redder than usual in this photo. This can be worth mentioning at a dental visit.",
    "visible gum swelling":
      "The gum tissue appears swollen in this photo. If this persists or grows, a dental check is recommended.",
    "visible bleeding":
      "The photo shows what may be bleeding near the gum or tooth. This is worth discussing with a dentist, especially if it recurs.",
    "visible discharge-like area":
      "An area that may be discharge is visible in the photo. This should be assessed by a dentist promptly.",
    "visible facial swelling":
      "The photo shows what may be facial swelling. If this is spreading or you feel unwell, seek prompt care.",
    "obvious trauma":
      "The photo shows signs that may indicate trauma or injury. A dentist should assess this as soon as possible.",
    "no obvious visible abnormality":
      "No obvious visible abnormality was detected in this photo. Many dental problems cannot be detected from a smartphone photo.",
  };

  // Maps an AI category to the same sign id used by the manual photo
  // checklist, so both evidence sources share one severity table.
  const CATEGORY_TO_SIGN_ID = {
    "visible dark area": "darkHole",
    "visible tooth damage or chip": "brokenTooth",
    "visible crack-like feature": "brokenTooth",
    "visible gum redness": "redness",
    "visible gum swelling": "gumSwelling",
    "visible bleeding": "bleeding",
    "visible discharge-like area": "pus",
    "visible facial swelling": "facialSwelling",
    "obvious trauma": "trauma",
    "no obvious visible abnormality": null,
  };

  let session = null;
  let backend = null; // 'webgpu' | 'wasm' | null
  let ortLoadPromise = null;
  let modelAvailability = null; // cached { exists } result

  function maxSeverity(a, b) {
    return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
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
      const res = await fetch(MODEL_URL, { method: "HEAD" });
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
        session = await window.ort.InferenceSession.create(MODEL_URL, {
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
   * Checks brightness, blur, and resolution on the full-size photo canvas.
   * AI analysis must not run on a photo that fails this gate.
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

    return {
      brightness,
      blurScore,
      width,
      height,
      overallOk: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Resizes the photo to the model's expected input and returns an
   * ort.Tensor (float32, NCHW, 0-1 range). Uses a throwaway canvas so the
   * full-resolution photo buffer isn't duplicated any longer than needed.
   */
  function preprocessDentalImage(canvas) {
    const resized = document.createElement("canvas");
    resized.width = INPUT_SIZE;
    resized.height = INPUT_SIZE;
    const ctx = resized.getContext("2d");
    ctx.drawImage(canvas, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

    const plane = INPUT_SIZE * INPUT_SIZE;
    const chw = new Float32Array(3 * plane);
    for (let p = 0; p < plane; p++) {
      chw[p] = data[p * 4] / 255;
      chw[plane + p] = data[p * 4 + 1] / 255;
      chw[plane * 2 + p] = data[p * 4 + 2] / 255;
    }

    resized.width = 0;
    resized.height = 0;

    return new window.ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }

  function softmax(values) {
    const max = Math.max(...values);
    const exps = values.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum);
  }

  /**
   * Converts the raw model output tensor into labeled, sorted
   * {category, confidence} findings, and flags the result as uncertain
   * when confidence is low or the top two categories are too close to
   * call.
   */
  function interpretModelOutput(outputTensor) {
    const raw = Array.from(outputTensor.data);
    const looksNormalized =
      raw.every((v) => v >= 0 && v <= 1) && Math.abs(raw.reduce((a, b) => a + b, 0) - 1) < 0.05;
    const probs = looksNormalized ? raw : softmax(raw);

    const findings = CATEGORIES.map((category, i) => ({
      category,
      confidence: probs[i] || 0,
    })).sort((a, b) => b.confidence - a.confidence);

    const [top, second] = findings;
    const uncertain =
      !top || top.confidence < CONFIDENCE_THRESHOLD || (second && top.confidence - second.confidence < UNCERTAIN_MARGIN);

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

    const signIds = new Set(
      aiResult.findings
        .filter((f) => f.confidence >= CONFIDENCE_THRESHOLD && f.category !== "no obvious visible abnormality")
        .map((f) => CATEGORY_TO_SIGN_ID[f.category])
        .filter(Boolean)
    );

    let aiLevel = "green";
    if (signIds.has("pus") || signIds.has("facialSwelling") || signIds.has("redness") || signIds.has("trauma") || signIds.has("bleeding")) {
      aiLevel = "red";
    } else if (signIds.has("darkHole") || signIds.has("gumSwelling") || signIds.has("brokenTooth")) {
      aiLevel = "yellow";
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
    CATEGORIES,
    CATEGORY_EXPLANATIONS,
    CATEGORY_TO_SIGN_ID,
    CONFIDENCE_THRESHOLD,
  };
})();

window.DentalAI = DentalAI;
