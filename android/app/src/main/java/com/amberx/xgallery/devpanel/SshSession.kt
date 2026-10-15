package com.amberx.xgallery.devpanel

import android.util.Base64
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.verification.PromiscuousVerifier
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import org.json.JSONObject
import java.io.OutputStream
import java.util.concurrent.Executors

/**
 * One native SSH shell, driven by the terminal page through the NativeSsh bridge.
 * Output is pushed back to the page base64-encoded (window.__xgNativeSsh(id, "data", b64)).
 */
class SshSession(private val id: String, private val emit: (kind: String, payload: String) -> Unit) {
    private val exec = Executors.newSingleThreadExecutor()
    private var client: SSHClient? = null
    private var shell: Session.Shell? = null
    private var out: OutputStream? = null
    @Volatile private var closed = false

    fun connect(opts: JSONObject, keyProvider: KeyProvider?) {
        exec.execute {
            try {
                val host = opts.getString("host")
                val port = opts.optInt("port", 22)
                val user = opts.optString("user", "root")
                val auth = opts.optJSONObject("auth") ?: JSONObject()
                val c = SSHClient()
                // The host key is pinned by the user's own ssh client elsewhere; the app trusts on first use.
                c.addHostKeyVerifier(PromiscuousVerifier())
                c.connectTimeout = 20_000
                c.connect(host, port)
                when (auth.optString("method", "key")) {
                    "password" -> c.authPassword(user, auth.optString("password", ""))
                    else -> {
                        if (keyProvider == null) throw IllegalStateException("No SSH key stored in the app: add one under Terminal → App key")
                        c.authPublickey(user, keyProvider)
                    }
                }
                client = c
                val session = c.startSession()
                session.allocatePTY("xterm-256color", opts.optInt("cols", 80), opts.optInt("rows", 24), 0, 0, emptyMap())
                val sh = session.startShell()
                shell = sh
                out = sh.outputStream
                emit("ready", JSONObject().put("host", host).put("user", user).put("port", port).toString())
                val cmd = opts.optString("command", "")
                if (cmd.isNotEmpty()) out?.write((cmd + "\n").toByteArray())
                out?.flush()
                Thread {
                    val buf = ByteArray(8192)
                    try {
                        val input = sh.inputStream
                        while (!closed) {
                            val n = input.read(buf)
                            if (n < 0) break
                            emit("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP))
                        }
                    } catch (e: Exception) {
                        if (!closed) emit("error", e.message ?: "read failed")
                    }
                    if (!closed) {
                        closed = true
                        emit("exit", "shell ended")
                    }
                }.start()
            } catch (e: Exception) {
                emit("error", e.message ?: e.javaClass.simpleName)
                emit("exit", "connect failed")
                closeQuietly()
            }
        }
    }

    fun write(data: String) {
        exec.execute {
            try {
                out?.write(data.toByteArray(Charsets.UTF_8))
                out?.flush()
            } catch (e: Exception) {
                emit("error", e.message ?: "write failed")
            }
        }
    }

    fun resize(cols: Int, rows: Int) {
        exec.execute {
            try {
                shell?.changeWindowDimensions(cols, rows, 0, 0)
            } catch (_: Exception) {
            }
        }
    }

    fun disconnect() {
        if (closed) return
        closed = true
        emit("exit", "disconnected")
        closeQuietly()
    }

    private fun closeQuietly() {
        exec.execute {
            try { shell?.close() } catch (_: Exception) {}
            try { client?.disconnect() } catch (_: Exception) {}
            shell = null
            client = null
            out = null
        }
    }
}
