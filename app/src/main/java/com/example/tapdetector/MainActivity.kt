package com.example.tapdetector

import android.Manifest
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.example.tapdetector.databinding.ActivityMainBinding
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.sqrt

/**
 * ステップ2: タップ回数（2回 / 3回）を区別して、以下の機能を実装したActivity。
 *
 *  - 2回叩く   → 録音の開始 / 停止（トグル）
 *  - 3回叩く   → 現在の日付と時刻を日本語音声で読み上げる(Text-to-Speech)
 *
 * 【2回と3回をどう区別しているか】
 * 「2回目のタップ」が来た瞬間には、まだ「これが2回で終わりなのか、
 * このあと3回目が来るのか」は分からない。
 * そこで、タップを検出するたびに「少し待ってから判定する」タイマーを
 * 仕掛け直す(リセットする)ようにしている。
 * 一定時間(TAP_GROUP_WINDOW_MS)だけ次のタップが来なければ、
 * 「そこまでに数えたタップ回数で確定」として、2回なら録音トグル、
 * 3回なら読み上げ、という処理を実行する。
 */
class MainActivity : AppCompatActivity(), SensorEventListener {

    // ------------------------------------------------------------
    // 調整可能なパラメータ（誤検知を減らすためにここの数値をチューニングする）
    // ------------------------------------------------------------

    companion object {
        /**
         * タップとみなす「衝撃の強さ」のしきい値。
         * 単位は m/s^2 で、重力(約9.8)を差し引いた「変化量」がこの値を超えたらタップとみなす。
         * 値を大きくすると鈍感に（弱い衝撃を無視）、小さくすると敏感になる。
         */
        private const val TAP_THRESHOLD = 12.0f

        /**
         * 1回のタップを検出した後、次のタップとして受け付けるまでの最短間隔(ミリ秒)。
         * これが無いと、1回叩いただけで加速度センサーの値が細かく振動し、
         * 何回もタップしたと誤検知してしまう。
         */
        private const val MIN_INTERVAL_BETWEEN_TAPS_MS = 120L

        /**
         * 「同じ一連のタップ（連続タップ）」とみなす、タップとタップの最大間隔(ミリ秒)。
         * この時間内に次のタップが来れば「同じグループ」としてカウントを続ける。
         * この時間を過ぎても次のタップが来なければ、そこまでのタップ回数で確定する。
         *
         * つまりこの値が「2回タップか3回タップかを見分けるための待ち時間」でもある。
         */
        private const val TAP_GROUP_WINDOW_MS = 450L

        /** 録音ファイル名に付ける日時のフォーマット（例: 2026-09-09_17-05） */
        private const val FILE_NAME_DATE_PATTERN = "yyyy-MM-dd_HH-mm"

        /** 読み上げる日時のフォーマット（例: 2026年9月9日 17時5分） */
        private const val SPEECH_DATE_PATTERN = "yyyy'年'M'月'd'日' H'時'm'分'"
    }

    // ------------------------------------------------------------
    // センサー関連
    // ------------------------------------------------------------

    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null

    // 画面のUI部品にアクセスするためのViewBinding
    private lateinit var binding: ActivityMainBinding

    // タイマー処理（一定時間後に判定を行う、表示を戻す等）を管理するHandler
    private val uiHandler = Handler(Looper.getMainLooper())

    // 現在数えている「一連のタップ」の時刻を記録するリスト
    private val tapTimestamps = mutableListOf<Long>()

    // タップ回数を確定させるための判定処理（TAP_GROUP_WINDOW_MS後に実行される）
    private val decideTapCountRunnable = Runnable { onTapGroupFinished() }

    // ------------------------------------------------------------
    // 録音関連
    // ------------------------------------------------------------

    private var mediaRecorder: MediaRecorder? = null
    private var isRecording = false
    private var currentOutputFile: File? = null

    // ------------------------------------------------------------
    // Text-to-Speech関連
    // ------------------------------------------------------------

    private var textToSpeech: TextToSpeech? = null
    private var isTtsReady = false

    // ------------------------------------------------------------
    // マイク権限（RECORD_AUDIO）の実行時リクエスト
    // ------------------------------------------------------------

    // 権限リクエストの結果を受け取るためのランチャー。
    // Activityがまだ「開始」状態になる前（＝コンストラクタ実行時）に登録しておく必要がある。
    private val requestRecordAudioPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            updateStatusDisplay()
            if (!granted) {
                Toast.makeText(this, getString(R.string.toast_permission_denied), Toast.LENGTH_LONG).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // センサーマネージャーを取得し、加速度センサーを取得する
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        // 日本語の音声合成エンジンを準備する
        textToSpeech = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val result = textToSpeech?.setLanguage(Locale.JAPAN)
                isTtsReady = result != TextToSpeech.LANG_MISSING_DATA &&
                    result != TextToSpeech.LANG_NOT_SUPPORTED
            }
        }

        // マイク権限がまだ無ければ、起動時にリクエストダイアログを出す
        if (!hasRecordAudioPermission()) {
            requestRecordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }

        if (accelerometer == null) {
            // 加速度センサーが無い端末では、その旨を表示する
            binding.statusTextView.text = "NO SENSOR"
        } else {
            updateStatusDisplay()
        }
    }

    override fun onResume() {
        super.onResume()
        // 画面が表示されている間だけセンサーの値を受け取るようにする（電池節約のため）
        accelerometer?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    override fun onPause() {
        super.onPause()
        // 画面が表示されていない間はセンサーの監視を止める
        sensorManager.unregisterListener(this)
    }

    override fun onDestroy() {
        super.onDestroy()
        // 画面が破棄されるときに、録音中であれば安全に止めてリソースを解放する
        if (isRecording) {
            stopRecordingInternal(discard = true)
        }
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        uiHandler.removeCallbacksAndMessages(null)
    }

    private fun hasRecordAudioPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
    }

    /**
     * 加速度センサーの値が更新されるたびに呼ばれる。
     * ここで「叩いた衝撃」を検出し、タップとして記録していく。
     */
    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]

        // 3軸の加速度から「合成された加速度の大きさ」を計算する
        val magnitude = sqrt(x * x + y * y + z * z)

        // 静止時は重力(約9.8 m/s^2)分だけ値が出るので、それを差し引いて
        // 「重力以外の変化量（＝叩いた衝撃の強さ）」を求める
        val delta = kotlin.math.abs(magnitude - SensorManager.GRAVITY_EARTH)

        if (delta > TAP_THRESHOLD) {
            handlePossibleTap()
        }
    }

    /**
     * しきい値を超える衝撃を検出したときに呼ばれる。
     * 「本当に新しい1回のタップか」を確認したうえで、タップ履歴に追加する。
     */
    private fun handlePossibleTap() {
        val now = System.currentTimeMillis()

        // 直前のタップから短時間しか経っていない場合は、
        // 同じ1回の衝撃の振動を誤って何回も数えている可能性が高いので無視する
        val lastTapTime = tapTimestamps.lastOrNull()
        if (lastTapTime != null && now - lastTapTime < MIN_INTERVAL_BETWEEN_TAPS_MS) {
            return
        }

        tapTimestamps.add(now)
        updateDebugText()

        // タップが来るたびに「判定タイマー」をリセットする。
        // → TAP_GROUP_WINDOW_MSの間、次のタップが来なければ onTapGroupFinished() が呼ばれる。
        uiHandler.removeCallbacks(decideTapCountRunnable)
        uiHandler.postDelayed(decideTapCountRunnable, TAP_GROUP_WINDOW_MS)
    }

    /**
     * 「一連のタップ」が終わった（＝TAP_GROUP_WINDOW_MSの間、次のタップが来なかった）ときに呼ばれる。
     * ここでタップ回数を確定し、2回なら録音トグル、3回なら読み上げを実行する。
     */
    private fun onTapGroupFinished() {
        val tapCount = tapTimestamps.size
        tapTimestamps.clear()
        updateDebugText()

        when (tapCount) {
            2 -> toggleRecording()
            3 -> speakCurrentDateTime()
            // 1回だけ、または4回以上は「意図した操作」ではないとみなして何もしない
        }
    }

    private fun updateDebugText() {
        binding.debugTextView.text = "しきい値:$TAP_THRESHOLD  タップ数:${tapTimestamps.size}"
    }

    // ------------------------------------------------------------
    // 録音の開始・停止
    // ------------------------------------------------------------

    private fun toggleRecording() {
        if (isRecording) {
            stopRecordingInternal(discard = false)
        } else {
            startRecording()
        }
    }

    private fun startRecording() {
        if (!hasRecordAudioPermission()) {
            Toast.makeText(this, getString(R.string.toast_permission_denied), Toast.LENGTH_LONG).show()
            // 権限が無いなら、この場でもう一度お願いする
            requestRecordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            return
        }

        val outputFile = createOutputFile()

        // API 31以降は MediaRecorder(Context) を使うことが推奨されている
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(this)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        try {
            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(outputFile.absolutePath)
                prepare()
                start()
            }
            mediaRecorder = recorder
            currentOutputFile = outputFile
            isRecording = true
            updateStatusDisplay()
        } catch (e: IOException) {
            recorder.release()
            Toast.makeText(this, getString(R.string.toast_recording_start_failed), Toast.LENGTH_LONG).show()
        } catch (e: IllegalStateException) {
            recorder.release()
            Toast.makeText(this, getString(R.string.toast_recording_start_failed), Toast.LENGTH_LONG).show()
        }
    }

    /**
     * 録音を停止する。
     * @param discard trueの場合は保存メッセージを出さない（Activity終了時の後始末などで使う）
     */
    private fun stopRecordingInternal(discard: Boolean) {
        val recorder = mediaRecorder
        val savedFile = currentOutputFile

        try {
            recorder?.stop()
        } catch (e: IllegalStateException) {
            // 録音時間が短すぎる等で stop() が失敗した場合は、ファイルを破棄扱いにする
        } finally {
            recorder?.release()
            mediaRecorder = null
        }

        isRecording = false
        currentOutputFile = null
        updateStatusDisplay()

        if (!discard && savedFile != null) {
            Toast.makeText(
                this,
                getString(R.string.toast_recording_saved, savedFile.name),
                Toast.LENGTH_LONG
            ).show()
        }
    }

    /**
     * 録音ファイルの保存先を作る。
     * アプリ専用の外部ストレージ領域（Android/data/アプリのパッケージ名/files/Music/）を使うため、
     * ストレージへの書き込み権限(WRITE_EXTERNAL_STORAGE)は不要。
     */
    private fun createOutputFile(): File {
        // 外部ストレージが使えない端末状態のときは、アプリ内部ストレージ(filesDir)に保存する
        val baseDir = getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: filesDir
        if (!baseDir.exists()) {
            baseDir.mkdirs()
        }
        val dateText = SimpleDateFormat(FILE_NAME_DATE_PATTERN, Locale.US).format(Date())
        val fileName = "${dateText}_recording.m4a"
        return File(baseDir, fileName)
    }

    // ------------------------------------------------------------
    // Text-to-Speech（日付と時刻の読み上げ）
    // ------------------------------------------------------------

    private fun speakCurrentDateTime() {
        val tts = textToSpeech
        if (tts == null || !isTtsReady) {
            return
        }
        val speechText = SimpleDateFormat(SPEECH_DATE_PATTERN, Locale.JAPAN).format(Date())
        tts.speak(speechText, TextToSpeech.QUEUE_FLUSH, null, "current_datetime")
    }

    // ------------------------------------------------------------
    // 画面表示の更新
    // ------------------------------------------------------------

    private fun updateStatusDisplay() {
        when {
            !hasRecordAudioPermission() -> {
                binding.statusTextView.text = getString(R.string.state_permission_needed)
                binding.rootLayout.setBackgroundColor(getColor(R.color.background_permission_needed))
            }
            isRecording -> {
                binding.statusTextView.text = getString(R.string.state_recording)
                binding.rootLayout.setBackgroundColor(getColor(R.color.background_recording))
            }
            else -> {
                binding.statusTextView.text = getString(R.string.state_ready)
                binding.rootLayout.setBackgroundColor(getColor(R.color.background_ready))
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // 精度変化は今回は特に使わないので何もしない
    }
}
