import { spawn, spawnSync } from 'node:child_process'
import type { RunInput, RunResult, StreamEvent } from './types.js'

/**
 * Backend 1: Claude Code's CLI on the owner's Claude subscription.
 *
 * The CLI authenticates with a long-lived OAuth token (`claude setup-token` on the owner's machine,
 * pasted into the assistant settings). Each conversation maps to a CLI session so the model keeps
 * its own context across turns; the working directory is the source workspace, so the built-in
 * Read/Grep/Glob tools give it the whole codebase, and Edit/Write/Bash are only allowed when the
 * owner has switched code changes on.
 */

export function cliAvailable(): boolean {
  try {
    return spawnSync(process.env.CLAUDE_BIN ?? 'claude', ['--version'], { stdio: 'ignore', timeout: 8000 }).status === 0
  } catch {
    return false
  }
}

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS']
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash(git diff *)', 'Bash(git status *)', 'Bash(npm run build *)', 'Bash(npx tsc *)', 'Bash(ls *)', 'Bash(cat *)']

export async function runCli(input: RunInput, onEvent: (e: StreamEvent) => void): Promise<RunResult> {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-chrome']
  if (input.model) args.push('--model', input.model)
  if (input.cliSessionId) args.push('--resume', input.cliSessionId)
  args.push('--append-system-prompt', input.systemPrompt)
  args.push('--permission-mode', input.allowCodeChanges ? 'acceptEdits' : 'default')
  args.push('--allowedTools', ...(input.allowCodeChanges ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS))
  if (!input.allowCodeChanges) args.push('--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash')
  args.push('--', input.prompt)

  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: input.subscriptionToken, CI: '1', TERM: 'dumb' }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd: input.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    let sessionId = input.cliSessionId ?? null
    let stderr = ''
    let buffer = ''
    let streamedChars = 0
    const toolsUsed: string[] = []
    const timer = setTimeout(() => child.kill('SIGTERM'), input.timeoutMs ?? 10 * 60_000)
    input.signal?.addEventListener('abort', () => child.kill('SIGTERM'))

    const handle = (line: string) => {
      if (!line.trim()) return
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      if (typeof ev.session_id === 'string') sessionId = ev.session_id
      const type = ev.type as string
      if (type === 'stream_event') {
        const e = ev.event as { type?: string; delta?: { type?: string; text?: string } }
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
          text += e.delta.text
          streamedChars += e.delta.text.length
          onEvent({ type: 'text', text: e.delta.text })
        }
      } else if (type === 'assistant') {
        const msg = ev.message as { content?: { type: string; text?: string; name?: string; input?: unknown }[] }
        for (const block of msg?.content ?? []) {
          if (block.type === 'tool_use' && block.name) {
            toolsUsed.push(block.name)
            onEvent({ type: 'tool', name: block.name, input: summarizeInput(block.input) })
          } else if (block.type === 'text' && block.text && streamedChars === 0) {
            // No partial stream arrived (older CLI): emit the whole block.
            text += block.text
            onEvent({ type: 'text', text: block.text })
          }
        }
      } else if (type === 'result') {
        if (ev.is_error && typeof ev.result === 'string' && !text) onEvent({ type: 'text', text: ev.result })
        if (ev.is_error && typeof ev.result === 'string' && !text) text = ev.result
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (buffer) handle(buffer)
      if (code !== 0 && !text) {
        const detail = stderr.trim().split('\n').slice(-3).join(' ')
        reject(new Error(`Claude Code exited with code ${code}${detail ? `: ${detail}` : ''}`))
        return
      }
      resolve({ text, backend: 'subscription', cliSessionId: sessionId, toolsUsed })
    })
  })
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const key = ['file_path', 'path', 'pattern', 'command', 'query'].find((k) => typeof o[k] === 'string')
  return key ? String(o[key]).slice(0, 160) : ''
}

/** Verify a subscription token with the smallest possible turn. Resolves with the model's one-line reply. */
export function pingCli(token: string, model: string | undefined, timeoutMs = 90_000): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--max-turns', '1', '--no-chrome', '--disallowedTools', 'Bash', 'Edit', 'Write']
    if (model) args.push('--model', model)
    args.push('--', 'Reply with exactly: OK')
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token, CI: '1', TERM: 'dumb' }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    let out = ''
    let err = ''
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, detail: 'Timed out waiting for Claude Code' })
    }, timeoutMs)
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')))
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, detail: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let parsed: { is_error?: boolean; result?: string; subtype?: string } | null = null
      try {
        const line = out.trim().split('\n').find((l) => l.trim().startsWith('{')) ?? '{}'
        parsed = JSON.parse(line)
      } catch {
        parsed = null
      }
      if (code === 0 && parsed && !parsed.is_error) resolve({ ok: true, detail: `Claude Code answered: ${String(parsed.result ?? '').trim().slice(0, 80) || 'ok'}` })
      else resolve({ ok: false, detail: (parsed?.result ?? err.trim().split('\n').slice(-2).join(' ') ?? `exit code ${code}`).toString().slice(0, 300) || `exit code ${code}` })
    })
  })
}
