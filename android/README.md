# xGallery developer panel — Android app

A small Kotlin app that opens https://xgallery.amberxai.com/dev full-screen behind the phone's
biometric / PIN lock, keeps the owner signed in, and hands file pickers, downloads and external
links to the system. Links to the site's host open inside the app.

- Build locally: open this folder in Android Studio, or `gradle assembleDebug` with the Android SDK.
- CI: `.github/workflows/android.yml` builds the debug APK on every change under `android/` and
  publishes it to the `android-latest` GitHub release as `xgallery-dev-panel.apk`.
- The panel URL and host are build constants in `app/build.gradle.kts`.
