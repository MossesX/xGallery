plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.amberx.xgallery.devpanel"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.amberx.xgallery.devpanel"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "PANEL_URL", "\"https://dev.xgallery.amberxai.com/dev\"")
        buildConfigField("String", "PANEL_HOST", "\"dev.xgallery.amberxai.com\"")
        buildConfigField("String", "SITE_URL", "\"https://xgallery.amberxai.com/dev\"")
        buildConfigField("String", "SITE_HOST", "\"xgallery.amberxai.com\"")
    }

    buildFeatures {
        buildConfig = true
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
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.biometric:biometric:1.1.0")
    // Native SSH for the terminal page and encrypted key storage.
    implementation("com.hierynomus:sshj:0.38.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}

android.packaging {
    resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/versions/9/OSGI-INF/MANIFEST.MF")
}
