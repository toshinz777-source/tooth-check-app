package com.example.tapdetector

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.example.tapdetector.databinding.ActivityMainBinding
import kotlin.math.sqrt

/**
 * ステップ1: 「スマホ本体を2回叩いたら、画面に DOUBLE TAP と表示する」だけを実装したActivity。
 *
 * 仕組みの概要：
 *  1. 加速度センサー(Accelerometer)から、常にX/Y/Z軸方向の加速度が送られてくる。
 *  2. スマホを指で叩くと、その瞬間だけ加速度が大きく変化する（衝撃＝ピークが出る）。
 *  3. このピークを「1回のタップ」として検出する。
 *  4. 直近のタップの発生時刻を記録しておき、「短い時間の中で2回」タップが検出されたら
 *     ダブルタップとみなして画面表示を切り替える。
 *
 * 録音やテキスト読み上げは、この後のステップで追加していく。
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
         * 「連続タップ」とみなす時間の幅(ミリ秒)。
         * この時間内に2回タップが検出されたら「ダブルタップ」と判定する。
         */
        private const val DOUBLE_TAP_WINDOW_MS = 500L

        /**
         * 「DOUBLE TAP」と表示したあと、何ミリ秒後に「READY」表示へ自動的に戻すか。
         */
        private const val DISPLAY_RESET_DELAY_MS = 1500L
    }

    // ------------------------------------------------------------
    // センサー関連
    // ------------------------------------------------------------

    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null

    // 画面のUI部品にアクセスするためのViewBinding
    private lateinit var binding: ActivityMainBinding

    // 「READY」表示に戻すための遅延処理を管理するHandler
    private val uiHandler = Handler(Looper.getMainLooper())

    // 直前に検出した「1回のタップ」の時刻（ミリ秒）。まだ無ければ0。
    private var lastTapTimeMs = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // センサーマネージャーを取得し、加速度センサーを取得する
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        if (accelerometer == null) {
            // 加速度センサーが無い端末では、その旨を表示して終了する
            binding.statusTextView.text = "NO SENSOR"
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

    /**
     * 加速度センサーの値が更新されるたびに呼ばれる。
     * ここで「叩いた衝撃」を検出し、ダブルタップかどうかを判定する。
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
     * ここで「本当に新しい1回のタップか」「ダブルタップが成立したか」を判定する。
     */
    private fun handlePossibleTap() {
        val now = System.currentTimeMillis()

        // 直前のタップから短時間しか経っていない場合は、
        // 同じ1回の衝撃の振動を誤って何回も数えている可能性が高いので無視する
        if (now - lastTapTimeMs < MIN_INTERVAL_BETWEEN_TAPS_MS) {
            return
        }

        // 前回のタップから「ダブルタップ判定の時間幅」以内であれば、ダブルタップ成立
        val isDoubleTap = (lastTapTimeMs != 0L) && (now - lastTapTimeMs <= DOUBLE_TAP_WINDOW_MS)

        if (isDoubleTap) {
            onDoubleTapDetected()
            // 3回目のタップを誤って次のダブルタップの1回目として数えないよう、
            // 一旦タップ履歴をリセットする
            lastTapTimeMs = 0L
        } else {
            // これが「1回目のタップ」として記録される
            lastTapTimeMs = now
        }
    }

    /**
     * ダブルタップが検出されたときの処理。
     * 画面に「DOUBLE TAP」と大きく表示し、一定時間後に「READY」へ自動で戻す。
     *
     * センサーのコールバックは別スレッドで呼ばれる可能性があるため、
     * UIの更新は必ずメインスレッド(runOnUiThread)で行う。
     */
    private fun onDoubleTapDetected() {
        runOnUiThread {
            binding.statusTextView.text = getString(R.string.state_double_tap)
            binding.rootLayout.setBackgroundColor(getColor(R.color.background_double_tap))

            // 予約済みの「READY表示に戻す」処理があれば一旦キャンセルしてから、
            // 新しく表示リセットを予約し直す
            uiHandler.removeCallbacksAndMessages(null)
            uiHandler.postDelayed({
                binding.statusTextView.text = getString(R.string.state_ready)
                binding.rootLayout.setBackgroundColor(getColor(R.color.background_ready))
            }, DISPLAY_RESET_DELAY_MS)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // 精度変化は今回は特に使わないので何もしない
    }
}
