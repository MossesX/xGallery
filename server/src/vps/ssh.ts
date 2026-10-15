import ssh2 from 'ssh2'
import type { Client as SshClient, SFTPWrapper } from 'ssh2'
import { getOps, type ShellProfile } from '../ops.js'
import { getSshConfig, hostKeyCheck } from '../terminal.js'
import { HttpError } from '../util.js'

const { Client } = ssh2

/**
 * Non-interactive SSH for the VPS manager: run a command, or work with SFTP, on a shell profile
 * using the panel's stored key. Every call opens a short-lived connection; the VPS manager's
 * pages batch what they need into one call each.
 */

export function profileById(id?: string): ShellProfile {
  const ops = getOps()
  const p = (id && ops.shell.profiles.find((x) => x.id === id)) || ops.shell.profiles.find((x) => x.id === ops.shell.defaultProfile) || ops.shell.profiles[0]
  if (!p) throw new HttpError(400, 'No shell profile configured (Remote shell tab)')
  return p
}

export function connect(profile: ShellProfile, password?: string): Promise<SshClient> {
  const cfg = getSshConfig()
  if (!password && !cfg.privateKey) throw new HttpError(400, 'No panel SSH key yet: generate one in Terminal → Key and install it on the VPS')
  return new Promise((resolve, reject) => {
    const c = new Client()
    const timer = setTimeout(() => {
      c.end()
      reject(new HttpError(504, `Timed out connecting to ${profile.user}@${profile.host}:${profile.port}`))
    }, 25_000)
    c.on('ready', () => {
      clearTimeout(timer)
      resolve(c)
    })
    c.on('error', (e) => {
      clearTimeout(timer)
      reject(new HttpError(502, `SSH to ${profile.host}: ${e.message}`))
    })
    c.connect({ host: profile.host, port: profile.port, username: profile.user, readyTimeout: 20_000, hostVerifier: (key: Buffer) => hostKeyCheck(profile.host, key).ok, ...(password ? { password } : { privateKey: cfg.privateKey, passphrase: cfg.passphrase || undefined }) })
  })
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  ms: number
}

export function execOn(client: SshClient, command: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<ExecResult> {
  const max = opts.maxBytes ?? 2_000_000
  return new Promise((resolve, reject) => {
    const started = Date.now()
    client.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(new HttpError(502, err.message))
      let out = ''
      let errOut = ''
      const timer = setTimeout(() => {
        stream.close()
        resolve({ stdout: out, stderr: `${errOut}\n[timed out after ${opts.timeoutMs ?? 60_000} ms]`, code: null, ms: Date.now() - started })
      }, opts.timeoutMs ?? 60_000)
      stream.on('data', (d: Buffer) => {
        if (out.length < max) out += d.toString('utf8')
      })
      stream.stderr.on('data', (d: Buffer) => {
        if (errOut.length < max) errOut += d.toString('utf8')
      })
      stream.on('close', (code: number | null) => {
        clearTimeout(timer)
        resolve({ stdout: out, stderr: errOut, code, ms: Date.now() - started })
      })
    })
  })
}

/** Run one command on a profile. */
export async function sshExec(profileId: string | undefined, command: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<ExecResult> {
  const p = profileById(profileId)
  const c = await connect(p)
  try {
    return await execOn(c, command, opts)
  } finally {
    c.end()
  }
}

/** Run several commands over one connection; results keyed by name. */
export async function sshBatch(profileId: string | undefined, commands: Record<string, string>, opts: { timeoutMs?: number } = {}): Promise<Record<string, ExecResult>> {
  const p = profileById(profileId)
  const c = await connect(p)
  const out: Record<string, ExecResult> = {}
  try {
    for (const [k, cmd] of Object.entries(commands)) out[k] = await execOn(c, cmd, opts)
    return out
  } finally {
    c.end()
  }
}

export async function withSftp<T>(profileId: string | undefined, fn: (sftp: SFTPWrapper, client: SshClient) => Promise<T>): Promise<T> {
  const p = profileById(profileId)
  const c = await connect(p)
  try {
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => c.sftp((err, s) => (err ? reject(new HttpError(502, err.message)) : resolve(s))))
    return await fn(sftp, c)
  } finally {
    c.end()
  }
}

export const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`

/** Parse the JSON-lines output docker prints with --format '{{json .}}'. */
export function jsonLines<T = Record<string, unknown>>(text: string): T[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as T
      } catch {
        return null
      }
    })
    .filter((x): x is T => x != null)
}
