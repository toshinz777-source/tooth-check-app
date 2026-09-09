# 音声シャッターカメラ (Android ネイティブアプリ)

ホーム画面のアイコンから直接起動できる、音声操作カメラの Android ネイティブアプリです。
CameraX(カメラ・フラッシュ制御)と Android 標準の音声認識(`SpeechRecognizer`, 日本語)を使っています。

## 機能

- 起動すると即カメラプレビューを表示(常時「撮影モード」)
- 「音声操作を開始」を押すと、日本語の音声を待ち受け
  - **「フラッシュオン」** → LEDフラッシュを点灯 → 撮影 → 自動でフラッシュを消灯
  - **「撮って」「撮影」「オン」** → フラッシュなしでそのまま撮影
- 撮影した写真は端末の `Pictures/VoiceShutterCamera` フォルダ(ギャラリーアプリから見える標準の写真フォルダ)に保存
- カメラ・マイクの権限を起動時にリクエスト(Android 9 以前は書き込み権限も併せてリクエスト)
- 音声が使えない場面向けに手動の「撮影」「フラッシュ」ボタンも搭載

## Android Studio を使わずに APK を作る方法(推奨: GitHub Actions)

このリポジトリには `.github/workflows/build-apk.yml` を用意済みです。
`android/` 配下に変更を push すると GitHub Actions が自動的に Android SDK を用意してビルドし、
APK を成果物(Artifact)としてアップロードします。**手元に Android Studio や Android SDK を一切インストールする必要はありません。**

### 手順

1. このブランチ(またはマージ後のブランチ)を GitHub に push する(すでに push 済みならこのステップは不要)。
2. GitHub リポジトリの **Actions** タブを開き、「Build Android APK」ワークフローの実行を確認する。
   - push で自動実行されます。手動で実行したい場合は Actions タブから `workflow_dispatch` (Run workflow) を使ってください。
3. ビルドが成功すると、`apk-latest` タグの GitHub Release に APK が自動でアップロードされます。
   スマートフォンのブラウザから直接次の URL を開けば、そのまま APK をダウンロードできます(ビルドのたびに同じ URL の中身が最新版に更新されます)。

   ```
   https://github.com/toshinz777-source/tooth-check-app/releases/latest/download/app-debug.apk
   ```

   (従来どおり Actions の実行ページ下部の **Artifacts** から `voice-shutter-camera-debug-apk` をダウンロードすることもできますが、こちらは GitHub へのログインと zip の展開が必要です。)

## Samsung Galaxy 実機へのインストール手順

1. 上記でダウンロードした `app-debug.apk` を Galaxy 端末に転送する。
   - 一番簡単なのは Google Drive などにアップロードし、端末側でダウンロードする方法です。
   - PCとUSB接続できる場合は、ファイル転送(MTP)でそのまま端末にコピーしても構いません。
2. 端末で `app-debug.apk` を開く(通知バーのダウンロード完了通知、または「マイファイル」アプリから)。
3. 初回は「不明なアプリのインストール」の許可を求められます。
   - `設定 → アプリ → (使用したアプリ、例: マイファイル / Chrome) → 不明なアプリのインストールを許可` をONにする。
   - ダイアログが出た場合はそのまま「許可」→「インストール」を選択。
4. インストール完了後、ホーム画面(またはアプリ一覧)に「音声シャッターカメラ」アイコンが追加されます。
5. アプリを開き、カメラ・マイクの権限確認ダイアログをすべて「許可」する。
6. カメラプレビューが表示されたら「音声操作を開始」をタップし、「フラッシュオン」または「撮って」と話しかけて動作確認する。
7. 撮影した写真は「ギャラリー」アプリの `VoiceShutterCamera` アルバムから確認できます。

※ Samsung Galaxy 実機はこちらのクラウド実行環境から直接操作できないため、上記の転送・インストール操作はお手元の端末で行ってください。

## (上級者向け) 自分の PC で手動ビルドする場合

Android Studio の GUI を開かずに、コマンドラインだけでビルドすることも可能です(Android SDK コマンドラインツールは必要です)。

```bash
# Android SDK コマンドラインツールを展開後、必要なパッケージを取得
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# このディレクトリ (android/) で実行
export ANDROID_HOME=/path/to/android-sdk
./gradlew assembleDebug

# 生成される APK
# app/build/outputs/apk/debug/app-debug.apk
```

生成された APK は上記の「Samsung Galaxy 実機へのインストール手順」と同じ方法で端末にインストールできます。

## プロジェクト構成

```
android/
├── app/
│   ├── build.gradle.kts        # アプリのビルド設定・依存関係(CameraX 等)
│   └── src/main/
│       ├── AndroidManifest.xml # 権限・起動アクティビティの定義
│       ├── java/.../MainActivity.kt  # カメラ・音声認識・撮影ロジック
│       └── res/                # レイアウト・文字列・アイコンなどのリソース
├── build.gradle.kts            # ルートのプラグイン宣言
├── settings.gradle.kts         # モジュール構成・リポジトリ設定
└── gradlew / gradlew.bat       # Gradle Wrapper(Gradle 本体のインストール不要)
```
