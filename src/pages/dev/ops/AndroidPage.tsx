import { Download, ExternalLink, Fingerprint, Smartphone, Wrench } from 'lucide-react'
import { useOps } from '../../../api/ops'
import { CommandBlock } from './CommandBlock'

/** The Android companion app: where to get it, what it does, how it is built. */
export function AndroidPage() {
  const { data } = useOps()
  const repo = data?.ops.repo ?? 'MossesX/xGallery'
  const domain = data?.ops.domain ?? 'xgallery.amberxai.com'
  const apk = `https://github.com/${repo}/releases/download/android-latest/xgallery-dev-panel.apk`
  const releases = `https://github.com/${repo}/releases/tag/android-latest`
  const actions = `https://github.com/${repo}/actions/workflows/android.yml`
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <div className="eyebrow">Operations</div>
        <h1 style={{ margin: 0 }}>
          <Smartphone size={22} /> Android app
        </h1>
        <p className="muted small" style={{ margin: '4px 0 0' }}>A native Android wrapper for this developer panel: full-screen, locked behind your phone’s fingerprint or PIN, with file uploads, pull-to-refresh and deep links. It is built from the android/ folder of the repository by a GitHub Actions workflow on every change and published as a release.</p>
      </div>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>
          <Download size={15} /> Install on your phone
        </h3>
        <ol className="dev-safety">
          <li>
            On the phone, open <a href={apk}>{apk}</a> (or the <a href={releases}>release page</a>) and download the APK.
          </li>
          <li>Allow installs from your browser when Android asks (“Install unknown apps”), then open the file.</li>
          <li>Launch “xGallery Dev”. It asks for your fingerprint or device PIN, then opens the developer panel sign-in.</li>
        </ol>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn primary" href={apk}>
            <Download size={14} /> Download the latest APK
          </a>
          <a className="btn" href={releases} target="_blank" rel="noreferrer">
            Release page <ExternalLink size={12} />
          </a>
          <a className="btn ghost" href={actions} target="_blank" rel="noreferrer">
            Build workflow <ExternalLink size={12} />
          </a>
        </div>
        <p className="muted small" style={{ margin: 0 }}>The release is created by the first successful run of the Android workflow; if the link is not live yet, check the workflow page. The APK is a debug-signed build for your own device; Play Store distribution would need a signing key (see below).</p>
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          <Fingerprint size={15} /> What the app does
        </h3>
        <ul className="dev-safety">
          <li>Opens https://{domain}/dev in an app window (no browser chrome); the site’s own sign-in and developer password still apply.</li>
          <li>Biometric or device-credential lock every time the app comes to the foreground.</li>
          <li>Keeps you signed in (cookies persist), supports file pickers for uploads, downloads open in the system browser, external links open outside the app.</li>
          <li>Back button navigates the panel; pull down to refresh; dark theme follows the system.</li>
          <li>Handles links to https://{domain}/… so a tapped link opens inside the app.</li>
        </ul>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>
          <Wrench size={15} /> Build it yourself
        </h3>
        <CommandBlock title="Build a debug APK locally (Android Studio or SDK + Gradle)" code={`git clone https://github.com/${repo}.git && cd $(basename ${repo})/android\n# with Android Studio: File → Open → the android folder → Run\n# or on the command line with the Android SDK installed:\ngradle assembleDebug\nls app/build/outputs/apk/debug/`} filename="android-build.sh" />
        <CommandBlock title="Trigger the GitHub build and download the APK from your machine" code={`gh workflow run android.yml --repo ${repo}\ngh run watch --repo ${repo} $(gh run list --repo ${repo} --workflow android.yml --limit 1 --json databaseId -q '.[0].databaseId')\ngh release download android-latest --repo ${repo} --pattern '*.apk' --clobber`} filename="android-ci.sh" />
        <CommandBlock title="Release signing (optional, for Play or sharing)" hint="then add the keystore as a base64 secret and sign in the workflow" code={`keytool -genkeypair -v -keystore xgallery-dev.keystore -alias xgallery -keyalg RSA -keysize 2048 -validity 10000\nbase64 -w0 xgallery-dev.keystore | gh secret set ANDROID_KEYSTORE_B64 --repo ${repo}\ngh secret set ANDROID_KEYSTORE_PASSWORD --repo ${repo}\ngh secret set ANDROID_KEY_ALIAS --body xgallery --repo ${repo}\ngh secret set ANDROID_KEY_PASSWORD --repo ${repo}`} filename="android-signing.sh" />
      </section>

      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>No install needed: add the panel to your home screen</h3>
        <p className="muted small" style={{ margin: 0 }}>Chrome on Android: open https://{domain}/dev → menu → “Add to Home screen” (or accept the “Install app” prompt). It opens full-screen like the app, without the biometric lock.</p>
      </section>
    </div>
  )
}
