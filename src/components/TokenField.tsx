import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { checkToken, normalizeToken, type TokenKind } from '../lib/tokenFormat'

/**
 * A credential input that checks its format on every keystroke and paste. Terminal wrapping, spaces
 * and quotes are removed as you go; a badge beside the field says "Valid format" or what is wrong
 * (Invalid format, Invalid link, Missing hyphens, Incomplete, wrong field). The eye shows the value:
 * with `gate`, only after the developer password is confirmed, and then it can also bring back the
 * saved value (`saved`).
 */
export function TokenField({
  kind,
  value,
  onChange,
  placeholder,
  id,
  label,
  autoFocus,
  gate,
  saved,
  testId,
  onEnter,
}: {
  kind: TokenKind
  value: string
  onChange: (clean: string) => void
  placeholder?: string
  id?: string
  label?: string
  autoFocus?: boolean
  gate?: { unlocked: boolean; unlock: (devPassword: string) => Promise<void> }
  saved?: string | null
  testId?: string
  onEnter?: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [asking, setAsking] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState(0)
  // After the developer password is confirmed the saved value arrives a moment later: fill it then.
  const [fillWhenSaved, setFillWhenSaved] = useState(false)
  useEffect(() => {
    if (!fillWhenSaved || !saved) return
    setFillWhenSaved(false)
    if (!value) onChange(saved)
  }, [fillWhenSaved, saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const check = checkToken(kind, value)
  const hint = check.state === 'ok' ? (removed > 0 ? `Removed ${removed} line break${removed === 1 ? '' : 's'}, spaces or quotes from the paste.` : '') : check.hint

  const show = () => {
    setVisible(true)
    if (!value && saved) onChange(saved)
  }
  const onEye = () => {
    if (visible) return setVisible(false)
    if (gate && !gate.unlocked) return setAsking(true)
    show()
  }
  const confirm = async () => {
    setBusy(true)
    setErr('')
    try {
      await gate!.unlock(pw)
      setAsking(false)
      setPw('')
      setVisible(true)
      setFillWhenSaved(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="token-field" data-token-field={testId ?? kind}>
      <div className="token-row">
        <input
          id={id}
          className={`input mono grow token-input ${check.state}`}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-label={label}
          aria-invalid={check.state === 'bad'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            const n = normalizeToken(e.target.value)
            setRemoved(n.removed)
            onChange(n.clean)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter && check.state === 'ok') {
              e.preventDefault()
              onEnter()
            }
          }}
          data-token-input=""
        />
        {check.state !== 'empty' && (
          <span className={`token-badge ${check.state}`} data-token-status={check.state} title={check.hint || check.label}>
            {check.state === 'ok' ? <Check size={12} /> : <AlertTriangle size={12} />} {check.label}
          </span>
        )}
        <button type="button" className="btn ghost icon sm token-eye" onClick={onEye} title={visible ? 'Hide' : gate && !gate.unlocked ? 'Show (asks for the developer password)' : saved && !value ? 'Show the saved value' : 'Show'} aria-label={visible ? 'Hide' : 'Show'} data-token-eye="">
          {visible ? <EyeOff size={15} /> : gate && !gate.unlocked ? <span className="token-eye-locked"><Eye size={15} /><Lock size={9} /></span> : <Eye size={15} />}
        </button>
      </div>
      {asking && (
        <div className="token-gate" data-token-gate="">
          <input className="input sm" type="password" autoComplete="off" autoFocus placeholder="Developer password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (pw) void confirm() } }} aria-label="Developer password" data-token-gate-password="" />
          <button type="button" className="btn sm" disabled={!pw || busy} onClick={() => void confirm()} data-token-gate-confirm="">
            {busy ? <Loader2 size={12} className="spin" /> : <Eye size={12} />} Show
          </button>
          <button type="button" className="btn ghost sm" onClick={() => { setAsking(false); setPw(''); setErr('') }}>
            Cancel
          </button>
          {err && <span className="token-gate-err small" data-token-gate-error="">{err}</span>}
        </div>
      )}
      {hint && <div className={`small token-hint ${check.state}`} data-token-hint="">{hint}</div>}
    </div>
  )
}

/** True when the field holds something that is not a valid credential: the save button stays grey. */
export function tokenBlocks(kind: TokenKind, value: string): boolean {
  return checkToken(kind, value).state === 'bad'
}
