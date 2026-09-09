package com.toshinz.voiceshuttercamera

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.toshinz.voiceshuttercamera.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var torchOn = false

    private var speechRecognizer: SpeechRecognizer? = null
    private var voiceEnabled = false

    private val requiredPermissions: Array<String>
        get() {
            val perms = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
            return perms.toTypedArray()
        }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            if (results.values.all { it }) {
                startCamera()
                initSpeechRecognizer()
            } else {
                Toast.makeText(this, "カメラとマイクの権限が必要です", Toast.LENGTH_LONG).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.shutterButton.setOnClickListener { capturePhoto(withFlash = false) }
        binding.torchButton.setOnClickListener { setTorch(!torchOn) }
        binding.voiceButton.setOnClickListener { toggleVoiceControl() }

        if (hasAllPermissions()) {
            startCamera()
            initSpeechRecognizer()
        } else {
            permissionLauncher.launch(requiredPermissions)
        }
    }

    private fun hasAllPermissions(): Boolean =
        requiredPermissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

    // ---------- Camera ----------

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            cameraProvider = providerFuture.get()
            bindCameraUseCases()
        }, ContextCompat.getMainExecutor(this))
    }

    private fun bindCameraUseCases() {
        val provider = cameraProvider ?: return

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(binding.previewView.surfaceProvider)
        }

        imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()

        try {
            provider.unbindAll()
            camera = provider.bindToLifecycle(
                this,
                CameraSelector.DEFAULT_BACK_CAMERA,
                preview,
                imageCapture
            )
            val torchAvailable = camera?.cameraInfo?.hasFlashUnit() == true
            binding.torchButton.isEnabled = torchAvailable
            binding.statusBadge.text = "撮影モード"
            binding.shutterButton.isEnabled = true
            binding.voiceButton.isEnabled = true
        } catch (exc: Exception) {
            Log.e(TAG, "カメラのバインドに失敗", exc)
            Toast.makeText(this, "カメラを起動できませんでした", Toast.LENGTH_LONG).show()
        }
    }

    private fun setTorch(on: Boolean) {
        val cam = camera ?: return
        if (!cam.cameraInfo.hasFlashUnit()) return
        cam.cameraControl.enableTorch(on)
        torchOn = on
    }

    private fun capturePhoto(withFlash: Boolean) {
        if (imageCapture == null) return
        if (withFlash) {
            setTorch(true)
            binding.previewView.postDelayed({
                takePicture {
                    binding.previewView.postDelayed({ setTorch(false) }, 150)
                }
            }, 350)
        } else {
            takePicture(null)
        }
    }

    private fun takePicture(afterSaved: (() -> Unit)?) {
        val capture = imageCapture ?: return
        val name = "VOICECAM_" +
            SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(System.currentTimeMillis())

        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT > Build.VERSION_CODES.P) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/VoiceShutterCamera")
            }
        }

        val outputOptions = ImageCapture.OutputFileOptions.Builder(
            contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            contentValues
        ).build()

        capture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    Toast.makeText(this@MainActivity, "写真を保存しました", Toast.LENGTH_SHORT).show()
                    afterSaved?.invoke()
                }

                override fun onError(exc: ImageCaptureException) {
                    Log.e(TAG, "撮影に失敗", exc)
                    Toast.makeText(this@MainActivity, "撮影に失敗しました", Toast.LENGTH_SHORT).show()
                    afterSaved?.invoke()
                }
            }
        )
    }

    // ---------- Voice control ----------

    private fun initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            binding.voiceStatusText.text = "音声認識: この端末では利用できません"
            binding.voiceButton.isEnabled = false
            return
        }
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(recognitionListener)
        }
    }

    private fun recognizerIntent(): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ja-JP")
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }

    private fun toggleVoiceControl() {
        if (voiceEnabled) stopVoiceControl() else startVoiceControl()
    }

    private fun startVoiceControl() {
        voiceEnabled = true
        binding.voiceButton.text = "音声操作を停止"
        binding.micDot.setBackgroundResource(R.drawable.mic_dot_active)
        binding.voiceStatusText.text = "音声認識: 聞き取り中..."
        speechRecognizer?.startListening(recognizerIntent())
    }

    private fun stopVoiceControl() {
        voiceEnabled = false
        binding.voiceButton.text = "音声操作を開始"
        binding.micDot.setBackgroundResource(R.drawable.mic_dot)
        binding.voiceStatusText.text = "音声認識: 停止中"
        speechRecognizer?.stopListening()
        speechRecognizer?.cancel()
    }

    private fun restartListeningIfNeeded() {
        if (voiceEnabled) {
            binding.previewView.postDelayed({
                if (voiceEnabled) speechRecognizer?.startListening(recognizerIntent())
            }, 300)
        }
    }

    private fun handleVoiceCommand(text: String) {
        val normalized = text.replace("\\s".toRegex(), "")
        binding.transcript.text = "認識: $text"

        val saysFlashOn = normalized.contains("フラッシュオン") ||
            (normalized.contains("フラッシュ") && normalized.contains("オン"))
        val saysCapture = normalized.contains("撮って") ||
            normalized.contains("撮影") ||
            normalized.contains("オン")

        when {
            saysFlashOn -> capturePhoto(withFlash = true)
            saysCapture -> capturePhoto(withFlash = false)
        }
    }

    private val recognitionListener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                voiceEnabled = false
                binding.voiceStatusText.text = "音声認識: マイク権限が必要です"
                return
            }
            restartListeningIfNeeded()
        }

        override fun onResults(results: Bundle) {
            val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            matches?.firstOrNull()?.let { handleVoiceCommand(it) }
            restartListeningIfNeeded()
        }

        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        speechRecognizer?.destroy()
    }

    companion object {
        private const val TAG = "VoiceShutterCamera"
    }
}
