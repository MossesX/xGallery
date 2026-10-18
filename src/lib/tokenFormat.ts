/**
 * Format checks for the Claude credentials, run on every keystroke and paste.
 *
 * A token copied from a terminal often arrives wrapped over several lines, indented, quoted or with
 * an `export CLAUDE_CODE_OAUTH_TOKEN=` prefix. Tokens never contain whitespace, so all of that is
 * removed first; what is left is checked against the real shapes:
 *   subscription token  sk-ant-oat01-<at least 40 of A-Z a-z 0-9 _ ->
 *   Anthropic API key   sk-ant-api03-<at least 40 of A-Z a-z 0-9 _ ->
 * The server applies the same rules (server/src/ai/tokens.ts) before it stores anything.
 */

export type TokenKind = 'subscription' | 'api'

export interface TokenCheck {
  /** The value with line breaks, spaces, quotes and shell prefixes removed: what gets saved. */
  clean: string
  state: 'empty' | 'ok' | 'bad'
  /** Short badge text. */
  label: string
  /** One sentence on what is wrong and how to fix it. */
  hint: string
  /** How many characters of whitespace / wrapping the clean-up removed. */
  removed: number
}

const PREFIX: Record<TokenKind, string> = { subscription: 'sk-ant-oat01-', api: 'sk-ant-api03-' }
const BODY = /^[A-Za-z0-9_-]+$/
const MIN_BODY = 40

export function normalizeToken(raw: string): { clean: string; removed: number } {
  let v = raw.replace(/[​-‍﻿ ]/g, ' ')
  v = v.replace(/^\s*(export\s+)?[A-Z_]*(TOKEN|KEY)\s*=\s*/i, '')
  const stripped = v.replace(/\s+/g, '')
  const unquoted = stripped.replace(/^["'`]+|["'`]+$/g, '')
  return { clean: unquoted, removed: raw.length - unquoted.length }
}

export function checkToken(kind: TokenKind, raw: string): TokenCheck {
  const { clean, removed } = normalizeToken(raw)
  const r = (state: TokenCheck['state'], label: string, hint: string): TokenCheck => ({ clean, state, label, hint, removed })
  if (!clean) return r('empty', '', '')
  const other: TokenKind = kind === 'subscription' ? 'api' : 'subscription'
  if (/^https?:|claude\.ai\/|console\.anthropic|oauth|[?&](state|code)=/i.test(clean)) return r('bad', 'Invalid link', 'This is the sign-in link, not the token. Open it, sign in, paste the code back into the terminal running "claude setup-token", then copy the sk-ant-oat01-… token it prints.')
  if (clean.startsWith(PREFIX[other].slice(0, 10)))
    return r('bad', kind === 'subscription' ? 'API key, wrong field' : 'Subscription token, wrong field', kind === 'subscription' ? 'This is an Anthropic API key (sk-ant-api…). Put it in the API key field.' : 'This is a Claude subscription token (sk-ant-oat…). Put it in the subscription token field.')
  const squashed = clean.toLowerCase().replace(/[^a-z0-9]/g, '')
  const want = PREFIX[kind].replace(/-/g, '')
  if (!clean.startsWith(PREFIX[kind])) {
    if (squashed.startsWith(want) || squashed.startsWith(PREFIX[other].replace(/-/g, ''))) return r('bad', 'Missing hyphens', `The start must read exactly ${PREFIX[kind]} with its hyphens; the paste lost or changed them.`)
    if (clean.includes('#') || (clean.length < 60 && /^[A-Za-z0-9_#-]+$/.test(clean))) return r('bad', 'Invalid format', kind === 'subscription' ? 'This looks like the short sign-in code from the browser. Paste it into the terminal running "claude setup-token"; it then prints the real token.' : 'Too short for an API key. Copy the whole key from console.anthropic.com → API keys.')
    return r('bad', 'Invalid format', `A ${kind === 'subscription' ? 'subscription token' : 'API key'} starts with ${PREFIX[kind]}`)
  }
  const body = clean.slice(PREFIX[kind].length)
  if (!BODY.test(body)) {
    const bad = [...new Set(body.replace(/[A-Za-z0-9_-]/g, ''))].slice(0, 6).join(' ')
    return r('bad', 'Invalid format', `Contains characters a key never has (${bad}). Copy it again from the terminal.`)
  }
  if (body.length < MIN_BODY) return r('bad', 'Incomplete', `Only ${clean.length} characters: the copy was cut short. A full ${kind === 'subscription' ? 'token' : 'key'} is about ${kind === 'subscription' ? 108 : 108} characters.`)
  return r('ok', 'Valid format', removed > 0 ? `Removed ${removed} line break${removed === 1 ? '' : 's'}, spaces or quotes from the paste.` : '')
}
