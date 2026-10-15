export type Backend = 'subscription' | 'api'

export interface RunInput {
  prompt: string
  systemPrompt: string
  /** Prior turns for the API backend (the CLI keeps its own session). */
  history: { role: 'user' | 'assistant'; content: string }[]
  cwd: string
  allowCodeChanges: boolean
  model: string
  subscriptionToken: string
  apiKey: string
  cliSessionId?: string | null
  timeoutMs?: number
  signal?: AbortSignal
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'tool'; name: string; input: string } | { type: 'status'; text: string }

export interface RunResult {
  text: string
  backend: Backend
  cliSessionId?: string | null
  toolsUsed: string[]
}

export interface AiSettings {
  enabled: boolean
  model: string
  subscriptionToken: string
  apiKey: string
  allowCodeChanges: boolean
  extraInstructions: string
  assistantName: string
  subscriptionVerifiedAt: number | null
  subscriptionVerifiedDetail: string
  apiVerifiedAt: number | null
  apiVerifiedDetail: string
}

export const DEFAULT_AI: AiSettings = {
  enabled: true,
  model: 'claude-opus-5-5',
  subscriptionToken: '',
  apiKey: '',
  allowCodeChanges: false,
  extraInstructions: '',
  assistantName: 'Amber',
  subscriptionVerifiedAt: null,
  subscriptionVerifiedDetail: '',
  apiVerifiedAt: null,
  apiVerifiedDetail: '',
}
