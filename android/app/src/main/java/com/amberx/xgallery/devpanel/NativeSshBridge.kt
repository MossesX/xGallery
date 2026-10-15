package com.amberx.xgallery.devpanel

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.util.Base64

/**
 * window.NativeSsh for the terminal page: real SSH from the phone (sshj), keys kept in the
 * Android keystore-backed encrypted preferences, and a hand-off to Termux for mosh.
 */
class NativeSshBridge(private val context: Context, private val web: WebView) {
    private val sessions = HashMap<String, SshSession>()
    private val prefs by lazy {
        val master = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(context, "ssh", master, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }

    private fun emit(id: String, kind: String, payload: String) {
        val js = "window.__xgNativeSsh && window.__xgNativeSsh(${JSONObject.quote(id)}, ${JSONObject.quote(kind)}, ${JSONObject.quote(payload)})"
        web.post { web.evaluateJavascript(js, null) }
    }

    private fun keyProvider(): KeyProvider? {
        val pem = prefs.getString("privateKey", null) ?: return null
        val pass = prefs.getString("passphrase", "") ?: ""
        val client = SSHClient()
        return if (pass.isEmpty()) client.loadKeys(pem, null, null) else client.loadKeys(pem, null, net.schmizz.sshj.userauth.password.PasswordUtils.createOneOff(pass.toCharArray()))
    }

    @JavascriptInterface
    fun connect(id: String, optsJson: String) {
        val opts = JSONObject(optsJson)
        val s = SshSession(id) { kind, payload -> emit(id, kind, payload) }
        synchronized(sessions) { sessions[id] = s }
        val provider = try { keyProvider() } catch (e: Exception) { emit(id, "error", "Stored key could not be read: ${e.message}"); null }
        s.connect(opts, provider)
    }

    @JavascriptInterface
    fun write(id: String, data: String) {
        synchronized(sessions) { sessions[id] }?.write(data)
    }

    @JavascriptInterface
    fun resize(id: String, cols: Int, rows: Int) {
        synchronized(sessions) { sessions[id] }?.resize(cols, rows)
    }

    @JavascriptInterface
    fun disconnect(id: String) {
        val s = synchronized(sessions) { sessions.remove(id) }
        s?.disconnect()
    }

    @JavascriptInterface
    fun hasStoredKey(): Boolean = prefs.contains("privateKey")

    @JavascriptInterface
    fun storeKey(privateKey: String, passphrase: String): String {
        return try {
            val client = SSHClient()
            val kp = if (passphrase.isEmpty()) client.loadKeys(privateKey, null, null) else client.loadKeys(privateKey, null, net.schmizz.sshj.userauth.password.PasswordUtils.createOneOff(passphrase.toCharArray()))
            val pub = kp.public
            prefs.edit().putString("privateKey", privateKey).putString("passphrase", passphrase).putString("publicKey", openSshPublic(pub)).apply()
            "ok"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    @JavascriptInterface
    fun clearKey() {
        prefs.edit().clear().apply()
    }

    @JavascriptInterface
    fun publicKey(): String = prefs.getString("publicKey", "") ?: ""

    /** Generates an RSA 3072 key inside the app (ed25519 PEM writing is not available in sshj without extra deps). */
    @JavascriptInterface
    fun generateKey(): String {
        return try {
            val gen = KeyPairGenerator.getInstance("RSA")
            gen.initialize(3072)
            val kp = gen.generateKeyPair()
            val pem = "-----BEGIN PRIVATE KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(kp.private.encoded) + "\n-----END PRIVATE KEY-----\n"
            val pub = openSshPublic(kp.public)
            prefs.edit().putString("privateKey", pem).putString("passphrase", "").putString("publicKey", pub).apply()
            pub
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    private fun openSshPublic(pub: java.security.PublicKey): String {
        val rsa = pub as java.security.interfaces.RSAPublicKey
        fun enc(b: ByteArray): ByteArray {
            val len = byteArrayOf((b.size ushr 24).toByte(), (b.size ushr 16).toByte(), (b.size ushr 8).toByte(), b.size.toByte())
            return len + b
        }
        val body = enc("ssh-rsa".toByteArray()) + enc(rsa.publicExponent.toByteArray()) + enc(rsa.modulus.toByteArray())
        return "ssh-rsa " + Base64.getEncoder().encodeToString(body) + " xgallery-android"
    }

    /** Open Termux with a command (needs allow-external-apps=true in Termux); falls back to launching Termux. */
    @JavascriptInterface
    fun openTermux(command: String): Boolean {
        return try {
            val run = Intent().apply {
                setClassName("com.termux", "com.termux.app.RunCommandService")
                action = "com.termux.RUN_COMMAND"
                putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
                putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", command))
                putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)
            }
            context.startForegroundService(run)
            true
        } catch (e: Exception) {
            val launch = context.packageManager.getLaunchIntentForPackage("com.termux")
            if (launch != null) {
                val clip = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clip.setPrimaryClip(android.content.ClipData.newPlainText("command", command))
                context.startActivity(launch)
                true
            } else false
        }
    }
}
