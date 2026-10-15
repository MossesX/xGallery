import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Layout of the task workspace: which lists are open as tabs, which float as windows, how each is
 * viewed, and where the lists column sits. Persisted per browser so the workspace comes back as left.
 */

export type ViewMode = 'tree' | 'grid'
export type TreeRoot = 'structure' | 'kind' | 'status' | 'priority' | 'tag' | 'due'

export interface Floating {
  x: number
  y: number
  w: number
  h: number
  minimized: boolean
  z: number
}

export interface ListView {
  mode: ViewMode
  root: TreeRoot
  showDone: boolean
  sort: 'manual' | 'title' | 'due' | 'priority' | 'updated'
  filterKind: '' | 'note' | 'todo' | 'task'
}

export const DEFAULT_VIEW: ListView = { mode: 'tree', root: 'structure', showDone: true, sort: 'manual', filterKind: '' }

interface TasksLayout {
  tabs: number[]
  activeTab: number | null
  floating: Record<number, Floating>
  views: Record<number, ListView>
  listsPanel: { docked: boolean; floating: Floating; width: number }
  previewWidth: number
  nextZ: number
  openTab: (id: number) => void
  closeTab: (id: number) => void
  setActive: (id: number | null) => void
  float: (id: number, at?: { x: number; y: number }) => void
  dock: (id: number) => void
  moveFloating: (id: number, patch: Partial<Floating>) => void
  raise: (id: number) => void
  setView: (id: number, patch: Partial<ListView>) => void
  setListsPanel: (patch: Partial<TasksLayout['listsPanel']>) => void
  moveListsPanel: (patch: Partial<Floating>) => void
  setPreviewWidth: (w: number) => void
  forget: (id: number) => void
}

const FLOAT: Floating = { x: 320, y: 120, w: 760, h: 520, minimized: false, z: 1 }

export const useTasksLayout = create<TasksLayout>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTab: null,
      floating: {},
      views: {},
      listsPanel: { docked: true, floating: { ...FLOAT, x: 40, y: 120, w: 300, h: 480 }, width: 260 },
      previewWidth: 380,
      nextZ: 2,
      openTab: (id) =>
        set((s) => {
          if (s.floating[id]) return { activeTab: s.activeTab }
          return { tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id], activeTab: id }
        }),
      closeTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t !== id)
          return { tabs, activeTab: s.activeTab === id ? (tabs[tabs.length - 1] ?? null) : s.activeTab }
        }),
      setActive: (id) => set({ activeTab: id }),
      float: (id, at) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t !== id)
          const n = Object.keys(s.floating).length
          const z = s.nextZ
          return { tabs, activeTab: s.activeTab === id ? (tabs[tabs.length - 1] ?? null) : s.activeTab, floating: { ...s.floating, [id]: { ...FLOAT, x: at?.x ?? FLOAT.x + n * 28, y: at?.y ?? FLOAT.y + n * 28, z } }, nextZ: z + 1 }
        }),
      dock: (id) =>
        set((s) => {
          const floating = { ...s.floating }
          delete floating[id]
          return { floating, tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id], activeTab: id }
        }),
      moveFloating: (id, patch) => set((s) => (s.floating[id] ? { floating: { ...s.floating, [id]: { ...s.floating[id], ...patch } } } : {})),
      raise: (id) =>
        set((s) => {
          if (!s.floating[id] || s.floating[id].z === s.nextZ - 1) return {}
          return { floating: { ...s.floating, [id]: { ...s.floating[id], z: s.nextZ } }, nextZ: s.nextZ + 1 }
        }),
      setView: (id, patch) => set((s) => ({ views: { ...s.views, [id]: { ...DEFAULT_VIEW, ...(s.views[id] ?? {}), ...patch } } })),
      setListsPanel: (patch) => set((s) => ({ listsPanel: { ...s.listsPanel, ...patch } })),
      moveListsPanel: (patch) => set((s) => ({ listsPanel: { ...s.listsPanel, floating: { ...s.listsPanel.floating, ...patch, z: patch.z ?? s.listsPanel.floating.z } } })),
      setPreviewWidth: (previewWidth) => set({ previewWidth }),
      forget: (id) => {
        const s = get()
        const floating = { ...s.floating }
        delete floating[id]
        const views = { ...s.views }
        delete views[id]
        const tabs = s.tabs.filter((t) => t !== id)
        set({ floating, views, tabs, activeTab: s.activeTab === id ? (tabs[tabs.length - 1] ?? null) : s.activeTab })
      },
    }),
    { name: 'xg-tasks-layout' },
  ),
)

export function viewOf(id: number): ListView {
  return { ...DEFAULT_VIEW, ...(useTasksLayout.getState().views[id] ?? {}) }
}
