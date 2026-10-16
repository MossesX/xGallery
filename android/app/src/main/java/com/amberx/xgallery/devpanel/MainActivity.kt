package com.amberx.xgallery.devpanel

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * xGallery developer panel for Android: a locked, full-screen window onto the web panel.
 *
 * - Biometric / device-credential prompt whenever the app returns to the foreground.
 * - Cookies persist, so the owner stays signed in; the site's own sign-in and developer
 *   password still gate everything.
 * - File pickers (uploads), downloads and external links are handed to the system.
 * - Links to the site's host open inside the app; the back button walks the panel's history.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var unlockedAt = 0L
    private var prompting = false

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        refresh = findViewById(R.id.refresh)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString xGalleryDevApp/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        // Real SSH from the phone for the terminal page (window.NativeSsh), plus the Termux hand-off.
        web.addJavascriptInterface(NativeSshBridge(this, web), "NativeSsh")
        applyCacheMode()

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == BuildConfig.PANEL_HOST) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (e: Exception) {
                    false
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                refresh.isRefreshing = false
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Only the main document matters; the service worker normally serves it offline.
                if (!request.isForMainFrame) return
                if (!isOnline()) { view.loadUrl("file:///android_asset/offline.html"); return }
                // The panel's own server is preferred; while its hostname is not set up yet, fall back to the panel inside the site.
                if (request.url.host == BuildConfig.PANEL_HOST) view.loadUrl(BuildConfig.SITE_URL)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val mime = params.acceptTypes.firstOrNull { it.isNotBlank() } ?: "*/*"
                pickFiles.launch(mime)
                return true
            }
        }
        web.setDownloadListener { url, _, _, _, _ ->
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) {
                Toast.makeText(this, R.string.no_handler, Toast.LENGTH_SHORT).show()
            }
        }
        refresh.setOnRefreshListener { web.reload() }
        // Only let the pull gesture start at the very top of the page.
        web.viewTreeObserver.addOnScrollChangedListener { refresh.isEnabled = web.scrollY == 0 }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(startUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { if (it.host == BuildConfig.PANEL_HOST) web.loadUrl(it.toString()) }
    }

    private fun startUrl(intent: Intent?): String {
        val data = intent?.data
        return if (data != null && (data.host == BuildConfig.PANEL_HOST || data.host == BuildConfig.SITE_HOST)) data.toString() else BuildConfig.PANEL_URL
    }

    override fun onResume() {
        super.onResume()
        applyCacheMode()
        // Lock again after two minutes in the background.
        if (System.currentTimeMillis() - unlockedAt > 2 * 60 * 1000) requireUnlock()
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Offline: serve everything the web view has cached; online: normal validation. */
    private fun applyCacheMode() {
        web.settings.cacheMode = if (isOnline()) WebSettings.LOAD_DEFAULT else WebSettings.LOAD_CACHE_ELSE_NETWORK
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun requireUnlock() {
        if (prompting) return
        val authenticators = BIOMETRIC_WEAK or DEVICE_CREDENTIAL
        val can = BiometricManager.from(this).canAuthenticate(authenticators)
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            // No lock set up on the device: nothing to ask for.
            unlockedAt = System.currentTimeMillis()
            web.visibility = WebView.VISIBLE
            return
        }
        web.visibility = WebView.INVISIBLE
        prompting = true
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                prompting = false
                unlockedAt = System.currentTimeMillis()
                web.visibility = WebView.VISIBLE
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                prompting = false
                if (errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON || errorCode == BiometricPrompt.ERROR_CANCELED) {
                    finish()
                } else {
                    Toast.makeText(this@MainActivity, errString, Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(getString(R.string.unlock_title))
            .setSubtitle(getString(R.string.unlock_subtitle))
            .setAllowedAuthenticators(authenticators)
            .build()
        prompt.authenticate(info)
    }
}
