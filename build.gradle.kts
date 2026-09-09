// プロジェクト全体で使うプラグインのバージョンをここでまとめて宣言する
// (各モジュールの build.gradle.kts では apply(false) で宣言だけしておき、
//  実際の適用は app/build.gradle.kts 側で行う)
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
