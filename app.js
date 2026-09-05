/* Tooth Check
 * Symptom-urgency guidance only. Never diagnoses a condition.
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

let currentAnswers = {};
let currentQuestionIndex = 0;

// ---------- Screen navigation ----------

function showScreen(name) {
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
    finishCheck();
  }
}

document.getElementById("back-btn").addEventListener("click", () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex -= 1;
    renderQuestion();
  }
});

// ---------- Result computation ----------

function computeResult(answers) {
  const swelling = answers.swelling === "Yes";
  const fever = answers.fever === "Yes";
  const pus = answers.pus === "Yes";
  const swallowBreath = answers.swallowBreath === "Yes";
  const nightPain = answers.nightPain === "Yes";
  const constantPain = answers.duration === "Constant pain";
  const severeConstantPain = constantPain && answers.painScore >= 7;
  const longDuration = answers.duration === "More than 30 minutes" || constantPain;
  const recurring = answers.frequency !== "First time";
  const moderateOrStrongPain = answers.painScore >= 4;
  const spontaneousPain = answers.triggers.includes("Pain without any trigger");
  const chewingPain = answers.triggers.includes("Chewing");

  if (swelling || fever || pus || swallowBreath || severeConstantPain) {
    return {
      level: "red",
      title: "Urgent Dental Care",
      message:
        "These symptoms can sometimes be associated with a serious dental problem and should be checked urgently. Please contact a dentist or seek medical care as soon as possible.",
      urgentMessage: swallowBreath || swelling ? "Seek urgent medical or dental care now." : null,
    };
  }

  if (recurring || moderateOrStrongPain || longDuration || spontaneousPain || chewingPain || nightPain) {
    return {
      level: "yellow",
      title: "Book a Dentist Soon",
      message:
        "Your symptoms should be checked by a dentist soon. Tooth pain that keeps returning may be caused by decay, sensitivity, a cracked tooth, or another dental problem.",
      urgentMessage: null,
    };
  }

  return {
    level: "green",
    title: "Monitor / Routine Dental Check",
    message:
      "Your symptoms do not appear urgent, but recurring tooth sensitivity can still need dental assessment. Consider booking a routine dental check if the problem continues.",
    urgentMessage: null,
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
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(date) {
  return `${date.getDate()} ${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
}

function finishCheck() {
  const result = computeResult(currentAnswers);
  const now = new Date();

  const history = loadHistory();
  const previousEntry = history.length ? history[history.length - 1] : null;

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
    resultLevel: result.level,
    resultTitle: result.title,
  };

  history.push(entry);
  saveHistory(history);

  renderResult(result, entry, previousEntry);
  showScreen("result");
  setActiveNav("check");
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

function renderResult(result, entry, previousEntry) {
  const badge = document.getElementById("result-badge");
  const title = document.getElementById("result-title");
  const message = document.getElementById("result-message");
  const urgentBanner = document.getElementById("result-urgent");
  const trendBanner = document.getElementById("trend-warning");

  badge.className = `result-badge ${result.level}`;
  title.className = `result-title ${result.level}`;
  title.textContent = result.title;
  message.textContent = result.message;

  if (result.urgentMessage) {
    urgentBanner.hidden = false;
    urgentBanner.textContent = result.urgentMessage;
  } else {
    urgentBanner.hidden = true;
  }

  const trendReasons = detectTrend(entry, previousEntry);
  if (trendReasons) {
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
    const history = loadHistory().filter((e) => e.id !== entry.id);
    saveHistory(history);
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

  return [
    "Dental Symptom Summary",
    `Location: ${latest.location}`,
    `Trigger: ${latest.triggers.join(", ")}`,
    `Pain level: ${latest.painScore}/10`,
    `Duration: ${latest.duration}`,
    `Frequency: ${frequencyDisplay}`,
    `Night pain: ${latest.nightPain}`,
    `Swelling: ${latest.swelling}`,
    `Symptoms started: ${started.dateDisplay}`,
    `App guidance: ${latest.resultTitle}`,
  ].join("\n");
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
