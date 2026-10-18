/** Server copy of the client's credential format rules (src/lib/tokenFormat.ts): clean, then check. */

export type TokenKind = 'subscription' | 'api'
const PREFIX: Record<TokenKind, string> = { subscription: 'sk-ant-oat01-', api: 'sk-ant-api03-' }

export function normalizeToken(raw: string): string {
  let v = raw.replace(/[​-‍﻿ ]/g, ' ')
  v = v.replace(/^\s*(export\s+)?[A-Z_]*(TOKEN|KEY)\s*=\s*/i, '')
  return v.replace(/\s+/g, '').replace(/^["'`]+|["'`]+$/g, '')
}

/** null when the cleaned value has the right shape, else a sentence saying what is wrong. */
export function tokenProblem(kind: TokenKind, clean: string): string | null {
  const other: TokenKind = kind === 'subscription' ? 'api' : 'subscription'
  if (/^https?:|claude\.ai\/|oauth|[?&](state|code)=/i.test(clean)) return 'Invalid link: that is the sign-in link, not the token'
  if (clean.startsWith(PREFIX[other].slice(0, 10))) return kind === 'subscription' ? 'That is an Anthropic API key (sk-ant-api…): paste it in the API key field' : 'That is a Claude subscription token (sk-ant-oat…): paste it in the subscription token field'
  if (!clean.startsWith(PREFIX[kind])) {
    if (clean.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(PREFIX[kind].replace(/-/g, ''))) return `Missing hyphens: it must start with ${PREFIX[kind]}`
    if (kind === 'subscription' && (clean.includes('#') || clean.length < 60)) return 'Invalid format: that looks like the sign-in code from the browser. Paste it into the terminal running "claude setup-token"; it then prints the real sk-ant-oat01-… token'
    return `Invalid format: it must start with ${PREFIX[kind]}`
  }
  const body = clean.slice(PREFIX[kind].length)
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return 'Invalid format: it contains characters a key never has'
  if (body.length < 40) return 'Incomplete: the copy was cut short'
  return null
}
