import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../api/client'
import { useUI } from '../../../store/ui'
import { CATALOG, fromCustom, type Command, type CustomSnippet } from './catalog'

/** Favourites, custom snippets and history of the command library, stored on the server and shared by every page that embeds it. */
export interface CommanderData {
  favorites: string[]
  customs: CustomSnippet[]
  history: { cmd: string; at: number; where: string }[]
  prefs: Record<string, unknown>
}
const EMPTY: CommanderData = { favorites: [], customs: [], history: [], prefs: {} }

export function useCommanderData() {
  const notify = useUI((s) => s.notify)
  const saved = useQuery({ queryKey: ['dev-commander'], queryFn: () => api.get<{ data: CommanderData }>('/api/dev/commander').then((r) => r.data) })
  const [data, setData] = useState<CommanderData>(EMPTY)
  const loaded = useRef(false)
  useEffect(() => {
    if (saved.data && !loaded.current) {
      setData(saved.data)
      loaded.current = true
    }
  }, [saved.data])
  const persist = useRef<ReturnType<typeof setTimeout> | null>(null)
  const update = useCallback(
    (patch: Partial<CommanderData>) => {
      setData((d) => {
        const next = { ...d, ...patch }
        if (persist.current) clearTimeout(persist.current)
        persist.current = setTimeout(() => api.put('/api/dev/commander', { data: next }).catch((e: Error) => notify(e.message, 'error')), 600)
        return next
      })
    },
    [notify],
  )
  const commands = useMemo<Command[]>(() => [...CATALOG, ...data.customs.map(fromCustom)], [data.customs])
  const favorites = useMemo(() => new Set(data.favorites), [data.favorites])
  const recent = useMemo(() => [...new Set(data.history.map((h) => (h.where.startsWith('cmd:') ? h.where.slice(4) : '')).filter(Boolean))].slice(0, 10), [data.history])
  const toggleFavorite = (id: string) => update({ favorites: favorites.has(id) ? data.favorites.filter((x) => x !== id) : [...data.favorites, id] })
  const remember = (cmd: Command | null, line: string, where: string) => update({ history: [{ cmd: line, at: Date.now(), where: cmd ? `cmd:${cmd.id}` : where }, ...data.history].slice(0, 200) })
  const saveCustom = (cs: CustomSnippet) => update({ customs: [...data.customs.filter((c) => c.id !== cs.id), cs] })
  const deleteCustom = (id: string) => update({ customs: data.customs.filter((c) => c.id !== id) })
  return { data, update, commands, favorites, recent, toggleFavorite, remember, saveCustom, deleteCustom }
}
