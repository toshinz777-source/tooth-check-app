plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    // アプリのパッケージ名（Javaパッケージと同じ書き方）
    namespace = "com.example.tapdetector"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.tapdetector"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        // レイアウトXMLのIDに直接アクセスできる ViewBinding を使う
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
}
