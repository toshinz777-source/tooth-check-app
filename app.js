/* Tooth Check
 * Symptom-urgency guidance only. Never diagnoses a condition.
 * Photo Check records user-reported visible signs only — there is no
 * automatic image analysis, since that would require sending photos to an
 * external AI service, which this app deliberately avoids.
 */

const HISTORY_KEY = "toothCheckHistory";

const QUESTIONS = [
  {
    id: "location",
    type: "single",
    prompt: "Where is the pain?",
    options: ["Upper left", "Upper right", "Lower left", "Lower right", "Not sure"],
  },
  {
    id: "triggers",
    type: "multi",
    prompt: "What triggers the pain?",
    options: [
      "Sweet food",
      "Cold drinks",
      "Hot drinks",
      "Chewing",
      "Brushing",
      "Pain without any trigger",
      "Other",
    ],
  },
  {
    id: "painScore",
    type: "slider",
    prompt: "How strong is the pain?",
  },
  {
    id: "duration",
    type: "single",
    prompt: "How long does the pain usually last?",
    options: [
      "A few seconds",
      "Less than 1 minute",
      "Several minutes",
      "More than 30 minutes",
      "Constant pain",
    ],
  },
  {
    id: "frequency",
    type: "single",
    prompt: "How often does it happen?",
    options: ["First time", "Occasionally", "Every day", "Several times a day"],
  },
  {
    id: "nightPain",
    type: "yesno",
    prompt: "Does the pain wake you up at night?",
  },
  {
    id: "swelling",
    type: "yesno",
    prompt: "Is there swelling in the gum, face, or jaw?",
  },
  {
    id: "fever",
    type: "yesno",
    prompt: "Do you have fever or feel unwell?",
  },
  {
    id: "pus",
    type: "yesno",
    prompt: "Is there pus, bad taste, or discharge near the tooth?",
  },
  {
    id: "swallowBreath",
    type: "yesno",
    prompt: "Is it difficult to swallow or breathe?",
  },
];

const DURATION_ORDER = [
  "A few seconds",
  "Less than 1 minute",
  "Several minutes",
  "More than 30 minutes",
  "Constant pain",
];

const FREQUENCY_ORDER = ["First time", "Occasionally", "Every day", "Several times a day"];

// Visible signs a user can report noticing in their own photo. This is a
// manual checklist, not automated image recognition — see the note at the
// top of this file.
const PHOTO_SIGNS = [
  { id: "brokenTooth", label: "Obvious broken or chipped tooth" },
  { id: "darkHole", label: "Large dark hole or severe discoloration" },
  { id: "gumSwelling", label: "Visible gum swelling" },
  { id: "bleeding", label: "Bleeding" },
  { id: "pus", label: "Visible pus or discharge" },
  { id: "redness", label: "Severe redness" },
  { id: "facialSwelling", label: "Facial swelling visible in the image" },
  { id: "trauma", label: "Trauma or missing tooth" },
  { id: "other", label: "Other obvious visible abnormality" },
];

const SEVERITY_ORDER = ["green", "yellow", "red", "emergency"];

let currentAnswers = {};
let currentQuestionIndex = 0;

let capturedPhotoDataUrl = null;
let selectedPhotoSigns = new Set();
let cameraStream = null;

// ---------- Screen navigation ----------

function showScreen(name) {
  stopCamera();

  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(`screen-${name}`).classList.add("active");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.screen;
    if (target === "check") {
      startCheck();
    } else if (target === "history") {
      renderHistory();
      showScreen("history");
    } else if (target === "summary") {
      resetSummaryScreen();
      showScreen("summary");
    } else {
      showScreen("home");
    }
  });
});

document.getElementById("start-check-btn").addEventListener("click", startCheck);
document.getElementById("result-home-btn").addEventListener("click", () => showScreen("home"));
document.getElementById("result-history-btn").addEventListener("click", () => {
  renderHistory();
  showScreen("history");
  setActiveNav("history");
});

function setActiveNav(name) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });
}

// ---------- Question flow ----------

function startCheck() {
  currentAnswers = {};
  currentQuestionIndex = 0;
  showScreen("question");
  setActiveNav("check");
  renderQuestion();
}

function renderQuestion() {
  const q = QUESTIONS[currentQuestionIndex];
  const total = QUESTIONS.length;

  document.getElementById("back-btn").hidden = currentQuestionIndex === 0;
  document.getElementById("progress-fill").style.width = `${(currentQuestionIndex / total) * 100}%`;
  document.getElementById("progress-label").textContent = `Question ${currentQuestionIndex + 1} of ${total}`;
  document.getElementById("question-prompt").textContent = q.prompt;

  const optionsContainer = document.getElementById("question-options");
  const nextBtn = document.getElementById("question-next-btn");
  optionsContainer.innerHTML = "";
  nextBtn.hidden = true;
  nextBtn.onclick = null;

  if (q.type === "single") {
    renderSingleOptions(q, optionsContainer);
  } else if (q.type === "yesno") {
    renderSingleOptions({ ...q, options: ["Yes", "No"] }, optionsContainer);
  } else if (q.type === "multi") {
    renderMultiOptions(q, optionsContainer, nextBtn);
  } else if (q.type === "slider") {
    renderSlider(q, optionsContainer, nextBtn);
  }
}

function renderSingleOptions(q, container) {
  q.options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = option;
    if (currentAnswers[q.id] === option) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      currentAnswers[q.id] = option;
      goToNextQuestion();
    });
    container.appendChild(btn);
  });
}

function renderMultiOptions(q, container, nextBtn) {
  const selected = new Set(currentAnswers[q.id] || []);

  q.options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = option;
    if (selected.has(option)) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      if (selected.has(option)) {
        selected.delete(option);
      } else {
        selected.add(option);
      }
      btn.classList.toggle("selected");
      nextBtn.disabled = selected.size === 0;
    });
    container.appendChild(btn);
  });

  nextBtn.hidden = false;
  nextBtn.disabled = selected.size === 0;
  nextBtn.textContent = "Next";
  nextBtn.onclick = () => {
    currentAnswers[q.id] = Array.from(selected);
    goToNextQuestion();
  };
}

function renderSlider(q, container, nextBtn) {
  const initial = currentAnswers[q.id] !== undefined ? currentAnswers[q.id] : 0;

  const wrapper = document.createElement("div");
  wrapper.className = "slider-container";

  const valueDisplay = document.createElement("div");
  valueDisplay.className = "slider-value";
  valueDisplay.innerHTML = `${initial} <span>/ 10</span>`;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "10";
  slider.value = String(initial);
  slider.addEventListener("input", () => {
    valueDisplay.innerHTML = `${slider.value} <span>/ 10</span>`;
  });

  const labels = document.createElement("div");
  labels.className = "slider-labels";
  labels.innerHTML = "<span>0 - No pain</span><span>10 - Worst pain</span>";

  wrapper.append(valueDisplay, slider, labels);
  container.appendChild(wrapper);

  nextBtn.hidden = false;
  nextBtn.disabled = false;
  nextBtn.textContent = "Next";
  nextBtn.onclick = () => {
    currentAnswers[q.id] = Number(slider.value);
    goToNextQuestion();
  };
}

function goToNextQuestion() {
  if (currentQuestionIndex < QUESTIONS.length - 1) {
    currentQuestionIndex += 1;
    renderQuestion();
  } else {
    resetPhotoScreen();
    showScreen("photo");
    setActiveNav("check");
  }
}

document.getElementById("back-btn").addEventListener("click", () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex -= 1;
    renderQuestion();
  }
});

// ---------- Photo Check ----------

function resetPhotoScreen() {
  capturedPhotoDataUrl = null;
  selectedPhotoSigns = new Set();
  document.getElementById("keep-photo-checkbox").checked = false;
  document.getElementById("photo-file-input").value = "";
  document.getElementById("camera-error").hidden = true;
  stopCamera();
  updatePhotoUiState();
}

function updatePhotoUiState() {
  const hasPhoto = !!capturedPhotoDataUrl;
  document.getElementById("photo-action-buttons").hidden = hasPhoto;
  document.getElementById("photo-preview-wrapper").hidden = !hasPhoto;
  document.getElementById("photo-checklist-wrapper").hidden = !hasPhoto;
}

async function openCamera() {
  const errorBox = document.getElementById("camera-error");
  errorBox.hidden = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    errorBox.hidden = false;
    errorBox.textContent = "Camera access is not supported in this browser. Please use Upload Photo instead.";
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    const video = document.getElementById("camera-video");
    video.srcObject = cameraStream;
    document.getElementById("camera-view-wrapper").hidden = false;
    document.getElementById("photo-action-buttons").hidden = true;
  } catch {
    errorBox.hidden = false;
    errorBox.textContent = "Could not access the camera. Please allow camera permission or use Upload Photo instead.";
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  const wrapper = document.getElementById("camera-view-wrapper");
  if (wrapper) wrapper.hidden = true;
}

function resizeToDataUrl(sourceEl, naturalWidth, naturalHeight, maxDim = 800) {
  let width = naturalWidth;
  let height = naturalHeight;

  if (width > height && width > maxDim) {
    height = Math.round(height * (maxDim / width));
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round(width * (maxDim / height));
    height = maxDim;
  }

  const canvas = document.getElementById("photo-canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(sourceEl, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function capturePhoto() {
  const video = document.getElementById("camera-video");
  const dataUrl = resizeToDataUrl(video, video.videoWidth, video.videoHeight);
  stopCamera();
  showPhotoPreview(dataUrl);
}

function handleFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const dataUrl = resizeToDataUrl(img, img.naturalWidth, img.naturalHeight);
      showPhotoPreview(dataUrl);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function showPhotoPreview(dataUrl) {
  capturedPhotoDataUrl = dataUrl;
  document.getElementById("photo-preview").src = dataUrl;
  updatePhotoUiState();
  renderPhotoChecklist();
}

function deletePhoto() {
  capturedPhotoDataUrl = null;
  selectedPhotoSigns.clear();
  document.getElementById("keep-photo-checkbox").checked = false;
  document.getElementById("photo-file-input").value = "";
  updatePhotoUiState();
}

function renderPhotoChecklist() {
  const container = document.getElementById("photo-checklist");
  container.innerHTML = "";

  PHOTO_SIGNS.forEach((sign) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = sign.label;
    if (selectedPhotoSigns.has(sign.id)) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      if (selectedPhotoSigns.has(sign.id)) {
        selectedPhotoSigns.delete(sign.id);
      } else {
        selectedPhotoSigns.add(sign.id);
      }
      btn.classList.toggle("selected");
    });
    container.appendChild(btn);
  });
}

document.getElementById("open-camera-btn").addEventListener("click", openCamera);
document.getElementById("cancel-camera-btn").addEventListener("click", () => {
  stopCamera();
  updatePhotoUiState();
});
document.getElementById("capture-photo-btn").addEventListener("click", capturePhoto);
document.getElementById("upload-photo-btn").addEventListener("click", () => {
  document.getElementById("photo-file-input").click();
});
document.getElementById("photo-file-input").addEventListener("change", handleFileUpload);
document.getElementById("delete-photo-btn").addEventListener("click", deletePhoto);

document.getElementById("skip-photo-btn").addEventListener("click", () => {
  deletePhoto();
  finishCheck();
});
document.getElementById("continue-photo-btn").addEventListener("click", () => {
  finishCheck();
});

/**
 * Records which visible warning signs the user reports noticing in their
 * photo. This is a manual checklist, NOT automated image recognition, and
 * it never produces a diagnosis — only a structured list of visible signs
 * that calculateCombinedUrgency() can weigh alongside the questionnaire.
 */
function analyzeDentalPhoto(selectedSignIds) {
  const findings = { hasPhoto: selectedSignIds !== null, signCount: 0 };
  const ids = selectedSignIds || [];
  PHOTO_SIGNS.forEach((sign) => {
    findings[sign.id] = ids.includes(sign.id);
  });
  findings.signCount = ids.length;
  return findings;
}

// ---------- Result computation ----------

function computeQuestionnaireUrgency(answers, trendReasons) {
  const swelling = answers.swelling === "Yes";
  const fever = answers.fever === "Yes";
  const pus = answers.pus === "Yes";
  const nightPain = answers.nightPain === "Yes";
  const constantPain = answers.duration === "Constant pain";
  const longDuration = answers.duration === "More than 30 minutes" || constantPain;
  const recurring = answers.frequency !== "First time";
  const strongPain = answers.painScore >= 7;
  const moderatePain = answers.painScore >= 4 && answers.painScore < 7;
  const spontaneousPain = answers.triggers.includes("Pain without any trigger");
  const chewingPain = answers.triggers.includes("Chewing");
  const worsening = Boolean(trendReasons && trendReasons.length);

  if (pus || swelling || (strongPain && (constantPain || longDuration)) || worsening) {
    return "red";
  }

  if (recurring || moderatePain || longDuration || spontaneousPain || chewingPain || nightPain || fever) {
    return "yellow";
  }

  return "green";
}

function computePhotoUrgency(pf) {
  if (!pf || !pf.hasPhoto) return "green";
  if (pf.pus || pf.facialSwelling || pf.redness || pf.trauma || pf.bleeding) return "red";
  if (pf.darkHole || pf.gumSwelling || pf.brokenTooth || pf.other) return "yellow";
  return "green";
}

function maxSeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

/**
 * Red flags always override the questionnaire and photo findings: if any
 * are present the result is EMERGENCY regardless of everything else.
 */
function detectRedFlags(answers, photoFindings, trendReasons) {
  const flags = [];

  if (answers.swallowBreath === "Yes") {
    flags.push("Difficulty swallowing or breathing");
  }
  if (answers.fever === "Yes" && answers.swelling === "Yes") {
    flags.push("Fever with facial or dental swelling");
  }
  if (answers.painScore >= 9 && answers.duration === "Constant pain") {
    flags.push("Severe uncontrolled pain");
  }
  if (photoFindings && photoFindings.trauma && photoFindings.bleeding) {
    flags.push("Major trauma with uncontrolled bleeding");
  }
  if (photoFindings && photoFindings.facialSwelling && trendReasons && trendReasons.includes("New swelling appeared")) {
    flags.push("Rapidly increasing facial swelling");
  }

  return flags;
}

/**
 * Combines questionnaire symptoms, photo warning signs, and red-flag
 * symptoms into a single urgency result. Red flags always win.
 */
function calculateCombinedUrgency(answers, photoFindings, trendReasons) {
  const redFlags = detectRedFlags(answers, photoFindings, trendReasons);

  if (redFlags.length > 0) {
    return {
      level: "emergency",
      title: "Seek urgent medical or dental care now",
      message:
        "Your symptoms may indicate a serious medical emergency. Please seek urgent medical or dental care immediately — an emergency department, urgent care clinic, or emergency dental service.",
      redFlags,
    };
  }

  const questionnaireLevel = computeQuestionnaireUrgency(answers, trendReasons);
  const photoLevel = computePhotoUrgency(photoFindings);
  const level = maxSeverity(questionnaireLevel, photoLevel);

  if (level === "red") {
    return {
      level: "red",
      title: "Urgent dental assessment",
      message:
        "These symptoms can sometimes be associated with a more serious dental problem and should be assessed urgently. Please contact a dentist as soon as possible.",
      redFlags: [],
    };
  }

  if (level === "yellow") {
    return {
      level: "yellow",
      title: "Book a dentist soon",
      message:
        "Your symptoms should be checked by a dentist soon. Tooth pain that keeps returning may be caused by decay, sensitivity, a cracked tooth, or another dental problem.",
      redFlags: [],
    };
  }

  return {
    level: "green",
    title: "Low urgency",
    message:
      "No urgent warning signs were identified. This does not rule out dental disease. If symptoms continue or recur, book a routine dental check.",
    redFlags: [],
  };
}

// ---------- History storage ----------

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage quota can be exceeded once saved photos are involved.
    // Retry without photo data rather than losing the check entirely.
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.map((e) => ({ ...e, photoDataUrl: null }))));
    } catch {
      // Give up silently; the check result is still shown to the user.
    }
  }
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(date) {
  return `${date.getDate()} ${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
}

function finishCheck() {
  const keepPhoto = document.getElementById("keep-photo-checkbox").checked && !!capturedPhotoDataUrl;
  const photoSignIds = Array.from(selectedPhotoSigns);
  const photoFindings = analyzeDentalPhoto(capturedPhotoDataUrl ? photoSignIds : null);

  const now = new Date();
  const history = loadHistory();
  const previousEntry = history.length ? history[history.length - 1] : null;
  const trendReasons = detectTrend(currentAnswers, previousEntry) || [];

  const result = calculateCombinedUrgency(currentAnswers, photoFindings, trendReasons);

  const entry = {
    id: crypto.randomUUID(),
    dateISO: now.toISOString(),
    dateDisplay: formatDate(now),
    location: currentAnswers.location,
    triggers: currentAnswers.triggers,
    painScore: currentAnswers.painScore,
    duration: currentAnswers.duration,
    frequency: currentAnswers.frequency,
    nightPain: currentAnswers.nightPain,
    swelling: currentAnswers.swelling,
    fever: currentAnswers.fever,
    pus: currentAnswers.pus,
    swallowBreath: currentAnswers.swallowBreath,
    photoTaken: photoFindings.hasPhoto,
    photoSigns: photoSignIds,
    photoDataUrl: keepPhoto ? capturedPhotoDataUrl : null,
    resultLevel: result.level,
    resultTitle: result.title,
  };

  history.push(entry);
  saveHistory(history);

  renderResult(result, trendReasons, photoFindings);
  showScreen("result");
  setActiveNav("check");

  capturedPhotoDataUrl = null;
  selectedPhotoSigns = new Set();
}

function detectTrend(current, previous) {
  if (!previous) return null;

  const reasons = [];
  if (current.painScore > previous.painScore) reasons.push("Pain score increased");
  if (DURATION_ORDER.indexOf(current.duration) > DURATION_ORDER.indexOf(previous.duration)) {
    reasons.push("Pain duration increased");
  }
  if (FREQUENCY_ORDER.indexOf(current.frequency) > FREQUENCY_ORDER.indexOf(previous.frequency)) {
    reasons.push("Symptoms became more frequent");
  }
  if (current.nightPain === "Yes" && previous.nightPain !== "Yes") reasons.push("New night pain appeared");
  if (current.swelling === "Yes" && previous.swelling !== "Yes") reasons.push("New swelling appeared");

  return reasons.length ? reasons : null;
}

function renderResult(result, trendReasons, photoFindings) {
  const badge = document.getElementById("result-badge");
  const title = document.getElementById("result-title");
  const message = document.getElementById("result-message");
  const redFlagBanner = document.getElementById("result-redflags");
  const photoSignsBanner = document.getElementById("result-photo-signs");
  const trendBanner = document.getElementById("trend-warning");
  const photoDisclaimer = document.getElementById("result-photo-disclaimer");

  badge.className = `result-badge ${result.level}`;
  title.className = `result-title ${result.level}`;
  title.textContent = result.title;
  message.textContent = result.message;

  if (result.redFlags && result.redFlags.length) {
    redFlagBanner.hidden = false;
    redFlagBanner.innerHTML =
      "Seek urgent medical or dental care now." +
      `<ul>${result.redFlags.map((r) => `<li>${r}</li>`).join("")}</ul>`;
  } else {
    redFlagBanner.hidden = true;
  }

  if (photoFindings && photoFindings.hasPhoto) {
    const noted = PHOTO_SIGNS.filter((s) => photoFindings[s.id]).map((s) => s.label);
    photoSignsBanner.hidden = false;
    photoSignsBanner.innerHTML = noted.length
      ? `Photo check noted:<ul>${noted.map((l) => `<li>${l}</li>`).join("")}</ul>`
      : "Photo check: no specific visible signs were noted.";
    photoDisclaimer.hidden = false;
  } else {
    photoSignsBanner.hidden = true;
    photoDisclaimer.hidden = true;
  }

  if (trendReasons && trendReasons.length) {
    trendBanner.hidden = false;
    trendBanner.innerHTML =
      "Your symptoms appear to be getting worse. Consider booking a dentist." +
      `<ul>${trendReasons.map((r) => `<li>${r}</li>`).join("")}</ul>`;
  } else {
    trendBanner.hidden = true;
  }
}

// ---------- History screen ----------

function renderHistory() {
  const history = loadHistory();
  const list = document.getElementById("history-list");
  const clearBtn = document.getElementById("clear-history-btn");
  list.innerHTML = "";

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No checks yet. Tap Check to get started.";
    list.appendChild(empty);
    clearBtn.hidden = true;
    return;
  }

  clearBtn.hidden = false;

  history
    .slice()
    .reverse()
    .forEach((entry) => {
      list.appendChild(createHistoryItem(entry));
    });
}

function createHistoryItem(entry) {
  const item = document.createElement("div");
  item.className = "history-item";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "history-delete-btn";
  deleteBtn.type = "button";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Delete entry");
  deleteBtn.addEventListener("click", () => {
    const updated = loadHistory().filter((e) => e.id !== entry.id);
    saveHistory(updated);
    renderHistory();
  });

  const date = document.createElement("div");
  date.className = "history-date";
  date.textContent = entry.dateDisplay;

  const triggers = document.createElement("div");
  triggers.className = "history-detail";
  triggers.textContent = entry.triggers.join(", ");

  const pain = document.createElement("div");
  pain.className = "history-detail";
  pain.textContent = `Pain ${entry.painScore}/10`;

  const duration = document.createElement("div");
  duration.className = "history-detail";
  duration.textContent = `Lasted ${entry.duration.toLowerCase()}`;

  const result = document.createElement("div");
  result.className = `history-result ${entry.resultLevel}`;
  result.textContent = `Result: ${entry.resultTitle}`;

  item.append(deleteBtn, date, triggers, pain, duration, result);

  if (entry.photoDataUrl) {
    const thumb = document.createElement("img");
    thumb.className = "history-thumb";
    thumb.src = entry.photoDataUrl;
    thumb.alt = "Saved dental photo";
    item.appendChild(thumb);
  } else if (entry.photoTaken) {
    const note = document.createElement("div");
    note.className = "history-detail";
    note.textContent = "Photo check included (not saved)";
    item.appendChild(note);
  }

  return item;
}

document.getElementById("clear-history-btn").addEventListener("click", () => {
  saveHistory([]);
  renderHistory();
});

// ---------- Dentist summary ----------

function resetSummaryScreen() {
  document.getElementById("summary-output").hidden = true;
  document.getElementById("copy-summary-btn").hidden = true;
  document.getElementById("copy-confirm").hidden = true;
}

function generateSummaryText() {
  const history = loadHistory();
  if (history.length === 0) return null;

  const latest = history[history.length - 1];
  const started = history[0];

  const frequencyDisplay = latest.frequency === "Every day" ? "Daily" : latest.frequency;

  const lines = [
    "Dental Symptom Summary",
    `Location: ${latest.location}`,
    `Trigger: ${latest.triggers.join(", ")}`,
    `Pain level: ${latest.painScore}/10`,
    `Duration: ${latest.duration}`,
    `Frequency: ${frequencyDisplay}`,
    `Night pain: ${latest.nightPain}`,
    `Swelling: ${latest.swelling}`,
    `Symptoms started: ${started.dateDisplay}`,
  ];

  if (latest.photoTaken) {
    const noted = PHOTO_SIGNS.filter((s) => (latest.photoSigns || []).includes(s.id)).map((s) => s.label);
    lines.push(`Photo check: ${noted.length ? noted.join(", ") : "No specific signs noted"}`);
  }

  lines.push(`App guidance: ${latest.resultTitle}`);

  return lines.join("\n");
}

document.getElementById("generate-summary-btn").addEventListener("click", () => {
  const output = document.getElementById("summary-output");
  const copyBtn = document.getElementById("copy-summary-btn");
  const confirm = document.getElementById("copy-confirm");
  confirm.hidden = true;

  const text = generateSummaryText();
  if (!text) {
    output.hidden = false;
    output.textContent = "Complete a symptom check first to create a dentist summary.";
    copyBtn.hidden = true;
    return;
  }

  output.hidden = false;
  output.textContent = text;
  copyBtn.hidden = false;
});

document.getElementById("copy-summary-btn").addEventListener("click", async () => {
  const text = document.getElementById("summary-output").textContent;
  const confirm = document.getElementById("copy-confirm");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable; fall back silently.
  }
  confirm.hidden = false;
});

// ---------- Init ----------

showScreen("home");
