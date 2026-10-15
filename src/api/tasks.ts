import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/* ---------- types mirrored from server/src/tasks.ts ---------- */

export type EntryKind = 'note' | 'todo' | 'task'
export type CoreRule = 'required' | 'optional' | 'hidden'
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'tags'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  options: string[]
  placeholder: string
  showInGrid: boolean
}

export interface TypeDef {
  label: string
  icon: string
  color: string
  core: { body: CoreRule; status: CoreRule; priority: CoreRule; due: CoreRule; tags: CoreRule; checklist: CoreRule; subtasks: CoreRule }
  statuses: string[]
  priorities: string[]
  defaultStatus: string
  defaultPriority: string
  fields: FieldDef[]
}

export type TypeSchema = Record<EntryKind, TypeDef>

export interface TaskList {
  id: number
  parentId: number | null
  title: string
  color: string
  icon: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  counts: { entries: number; done: number }
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Entry {
  id: number
  listId: number
  parentId: number | null
  kind: EntryKind
  title: string
  body: string
  status: string
  priority: string
  dueAt: number | null
  tags: string[]
  checklist: ChecklistItem[]
  fields: Record<string, unknown>
  sortOrder: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export const KINDS: EntryKind[] = ['note', 'todo', 'task']

/* ---------- hooks ---------- */

export const taskKeys = {
  types: ['tasks-types'] as const,
  lists: ['tasks-lists'] as const,
  list: (id: number) => ['tasks-list', id] as const,
  search: (p: Record<string, string>) => ['tasks-search', p] as const,
}

export function useTaskTypes(enabled = true) {
  return useQuery({ queryKey: taskKeys.types, queryFn: () => api.get<{ types: TypeSchema }>('/api/dev/tasks/types').then((r) => r.types), enabled, staleTime: 60_000 })
}

export function useTaskLists(enabled = true) {
  return useQuery({ queryKey: taskKeys.lists, queryFn: () => api.get<{ lists: TaskList[] }>('/api/dev/tasks/lists').then((r) => r.lists), enabled, refetchInterval: 20_000, refetchOnWindowFocus: true })
}

export function useListContents(id: number | null) {
  return useQuery({ queryKey: taskKeys.list(id ?? 0), queryFn: () => api.get<{ list: TaskList; lists: TaskList[]; entries: Entry[] }>(`/api/dev/tasks/lists/${id}/entries`), enabled: id != null, refetchInterval: 20_000, refetchOnWindowFocus: true })
}

export function useTaskSearch(p: { q?: string; kind?: string; status?: string }, enabled = true) {
  const params = Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string>
  const qs = new URLSearchParams(params).toString()
  return useQuery({ queryKey: taskKeys.search(params), queryFn: () => api.get<{ entries: Entry[] }>(`/api/dev/tasks/entries${qs ? `?${qs}` : ''}`).then((r) => r.entries), enabled: enabled && !!qs, placeholderData: (prev) => prev })
}

/** Invalidate every list-related query after a change (entries move between lists, counts change). */
export function useInvalidateTasks() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: taskKeys.lists })
    qc.invalidateQueries({ queryKey: ['tasks-list'] })
    qc.invalidateQueries({ queryKey: ['tasks-search'] })
  }
}

export function useTaskMutations() {
  const invalidate = useInvalidateTasks()
  const createList = useMutation({ mutationFn: (v: { title: string; parentId?: number | null; color?: string }) => api.post<{ list: TaskList }>('/api/dev/tasks/lists', v).then((r) => r.list), onSuccess: invalidate })
  const updateList = useMutation({ mutationFn: (v: { id: number } & Partial<Pick<TaskList, 'title' | 'parentId' | 'color' | 'icon' | 'sortOrder'>>) => api.put<{ list: TaskList }>(`/api/dev/tasks/lists/${v.id}`, v).then((r) => r.list), onSuccess: invalidate })
  const deleteList = useMutation({ mutationFn: (id: number) => api.del(`/api/dev/tasks/lists/${id}`), onSuccess: invalidate })
  const createEntry = useMutation({ mutationFn: (v: Partial<Entry> & { listId: number; kind: EntryKind; title: string; draft?: boolean }) => api.post<{ entry: Entry; warnings: string[] }>('/api/dev/tasks/entries', v), onSuccess: invalidate })
  const updateEntry = useMutation({ mutationFn: (v: { id: number; draft?: boolean } & Partial<Entry>) => api.put<{ entry: Entry; warnings: string[] }>(`/api/dev/tasks/entries/${v.id}`, v), onSuccess: invalidate })
  const deleteEntry = useMutation({ mutationFn: (id: number) => api.del(`/api/dev/tasks/entries/${id}`), onSuccess: invalidate })
  const bulk = useMutation({ mutationFn: (v: { ids: number[]; action: 'delete' | 'move' | 'duplicate' | 'patch'; listId?: number; parentId?: number | null; patch?: Record<string, unknown> }) => api.post<{ ok: boolean; count: number; errors?: string[] }>('/api/dev/tasks/entries/bulk', v), onSuccess: invalidate })
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.post('/api/dev/tasks/entries/reorder', { ids }), onSuccess: invalidate })
  const reorderLists = useMutation({ mutationFn: (ids: number[]) => api.post('/api/dev/tasks/lists/reorder', { ids }), onSuccess: invalidate })
  return { createList, updateList, deleteList, createEntry, updateEntry, deleteEntry, bulk, reorder, reorderLists }
}

export function useSaveTaskTypes() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (types: TypeSchema) => api.put<{ types: TypeSchema }>('/api/dev/tasks/types', { types }).then((r) => r.types), onSuccess: (types) => qc.setQueryData(taskKeys.types, types) })
}
