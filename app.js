(() => {
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  const flashOverlay = document.getElementById("flashOverlay");
  const statusBadge = document.getElementById("statusBadge");

  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const shutterBtn = document.getElementById("shutterBtn");
  const torchBtn = document.getElementById("torchBtn");
  const voiceBtn = document.getElementById("voiceBtn");

  const micIndicator = document.getElementById("micIndicator");
  const voiceStatusText = document.getElementById("voiceStatusText");
  const transcriptEl = document.getElementById("transcript");
  const warningEl = document.getElementById("warning");
  const gallery = document.getElementById("gallery");

  let stream = null;
  let videoTrack = null;
  let torchSupported = false;
  let torchOn = false;
  let recognition = null;
  let voiceEnabled = false;
  let shootingMode = false; // true while camera is live ("photo mode")

  function showWarning(message) {
    warningEl.textContent = message;
    warningEl.hidden = false;
  }

  function setStatusBadge(text) {
    statusBadge.textContent = text;
  }

  // ---------- Camera ----------

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      showWarning("カメラを起動できませんでした: " + err.message);
      return;
    }

    video.srcObject = stream;
    videoTrack = stream.getVideoTracks()[0];

    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    torchSupported = !!capabilities.torch;
    torchBtn.disabled = !torchSupported;
    if (!torchSupported) {
      showWarning(
        "この端末・ブラウザはフラッシュ(トーチ)制御に対応していないため、「フラッシュオン」と言っても撮影のみ行われます。"
      );
    }

    shootingMode = true;
    setStatusBadge("撮影モード");
    startBtn.hidden = true;
    stopBtn.hidden = false;
    shutterBtn.disabled = false;
    voiceBtn.disabled = false;
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    stream = null;
    videoTrack = null;
    torchSupported = false;
    torchOn = false;
    shootingMode = false;

    video.srcObject = null;
    setStatusBadge("カメラ停止中");
    startBtn.hidden = false;
    stopBtn.hidden = true;
    shutterBtn.disabled = true;
    torchBtn.disabled = true;
    voiceBtn.disabled = true;

    stopVoiceControl();
  }

  async function setTorch(on) {
    if (!videoTrack || !torchSupported) return false;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: on }] });
      torchOn = on;
      torchBtn.classList.toggle("active", on);
      return true;
    } catch (err) {
      showWarning("フラッシュの切り替えに失敗しました: " + err.message);
      return false;
    }
  }

  function flashScreenEffect() {
    flashOverlay.classList.remove("flashing");
    // force reflow so the animation can restart
    void flashOverlay.offsetWidth;
    flashOverlay.classList.add("flashing");
  }

  function capturePhoto() {
    if (!shootingMode || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    flashScreenEffect();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      addPhotoToGallery(url);
    }, "image/jpeg", 0.92);
  }

  async function captureWithFlash() {
    if (torchSupported) {
      await setTorch(true);
      // give the sensor/torch a moment to take effect before capturing
      await new Promise((resolve) => setTimeout(resolve, 350));
      capturePhoto();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await setTorch(false);
    } else {
      // no hardware torch available: still take the photo, use screen flash effect
      capturePhoto();
    }
  }

  function addPhotoToGallery(url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "撮影した写真";
    gallery.prepend(img);
  }

  // ---------- Voice control ----------

  function getSpeechRecognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function initVoiceControl() {
    const SpeechRecognitionClass = getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) {
      voiceBtn.disabled = true;
      voiceStatusText.textContent = "音声認識: 非対応のブラウザです";
      showWarning(
        "このブラウザは音声認識(Web Speech API)に対応していません。Android版Chromeなどでお試しください。"
      );
      return;
    }

    recognition = new SpeechRecognitionClass();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const text = last[0].transcript.trim();
      transcriptEl.textContent = "認識: " + text;
      handleVoiceCommand(text);
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      voiceStatusText.textContent = "音声認識エラー: " + event.error;
    };

    recognition.onend = () => {
      // keep listening continuously while voice control is enabled and camera is live
      if (voiceEnabled && shootingMode) {
        try {
          recognition.start();
        } catch (_) {
          /* already starting */
        }
      } else {
        micIndicator.classList.remove("listening");
        voiceStatusText.textContent = "音声認識: 停止中";
      }
    };
  }

  function normalize(text) {
    return text.replace(/\s+/g, "").toLowerCase();
  }

  function handleVoiceCommand(rawText) {
    if (!shootingMode) return;
    const text = normalize(rawText);

    const saysFlashOn =
      text.includes("フラッシュオン") ||
      (text.includes("フラッシュ") && text.includes("オン")) ||
      text.includes("flashon");

    const saysOn = text.includes("オン") || text.includes("on");

    if (saysFlashOn) {
      captureWithFlash();
    } else if (saysOn) {
      capturePhoto();
    }
  }

  function startVoiceControl() {
    if (!recognition) return;
    voiceEnabled = true;
    try {
      recognition.start();
      micIndicator.classList.add("listening");
      voiceStatusText.textContent = "音声認識: 聞き取り中...";
      voiceBtn.textContent = "音声操作を停止";
      voiceBtn.classList.add("active");
    } catch (_) {
      /* recognition may already be running */
    }
  }

  function stopVoiceControl() {
    voiceEnabled = false;
    voiceBtn.textContent = "音声操作を開始";
    voiceBtn.classList.remove("active");
    micIndicator.classList.remove("listening");
    voiceStatusText.textContent = "音声認識: 停止中";
    if (recognition) {
      try {
        recognition.stop();
      } catch (_) {
        /* ignore */
      }
    }
  }

  // ---------- Wiring ----------

  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", stopCamera);
  shutterBtn.addEventListener("click", capturePhoto);
  torchBtn.addEventListener("click", () => setTorch(!torchOn));
  voiceBtn.addEventListener("click", () => {
    if (voiceEnabled) stopVoiceControl();
    else startVoiceControl();
  });

  initVoiceControl();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    startBtn.disabled = true;
    showWarning("このブラウザ・環境ではカメラ(getUserMedia)を利用できません。HTTPS接続でお試しください。");
  }
})();
