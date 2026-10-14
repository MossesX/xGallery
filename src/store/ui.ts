import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '../theme/apply'
import type { PageContext, ThemeDraft } from '../api/types'

interface UIState {
  colorMode: ColorMode
  setColorMode: (m: ColorMode) => void
  /** Admin theme preview: temporarily apply a theme without saving it. */
  previewTheme: ThemeDraft | null
  setPreviewTheme: (t: ThemeDraft | null) => void
  /** Theme of the gallery currently being browsed, if it has one. */
  galleryTheme: ThemeDraft | null
  setGalleryTheme: (t: ThemeDraft | null) => void
  /** The assistant drawer: open state, the active conversation and context queued from a hook (banner, context menu, shortcut). */
  assistantOpen: boolean
  assistantConversationId: number | null
  assistantDraft: { text: string; context: PageContext } | null
  openAssistant: (opts?: { text?: string; context?: PageContext; conversationId?: number | null }) => void
  closeAssistant: () => void
  setAssistantConversation: (id: number | null) => void
  clearAssistantDraft: () => void
  toast: { id: number; message: string; tone: 'info' | 'error' | 'success' } | null
  notify: (message: string, tone?: 'info' | 'error' | 'success') => void
  dismissToast: () => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      colorMode: 'dark',
      setColorMode: (colorMode) => set({ colorMode }),
      previewTheme: null,
      setPreviewTheme: (previewTheme) => set({ previewTheme }),
      galleryTheme: null,
      setGalleryTheme: (galleryTheme) => set({ galleryTheme }),
      assistantOpen: false,
      assistantConversationId: null,
      assistantDraft: null,
      openAssistant: (opts = {}) =>
        set((st) => ({
          assistantOpen: true,
          assistantConversationId: opts.conversationId === undefined ? st.assistantConversationId : opts.conversationId,
          assistantDraft: opts.text != null || opts.context ? { text: opts.text ?? '', context: opts.context ?? {} } : st.assistantDraft,
        })),
      closeAssistant: () => set({ assistantOpen: false }),
      setAssistantConversation: (assistantConversationId) => set({ assistantConversationId }),
      clearAssistantDraft: () => set({ assistantDraft: null }),
      toast: null,
      notify: (message, tone = 'info') => set({ toast: { id: Date.now(), message, tone } }),
      dismissToast: () => set({ toast: null }),
    }),
    { name: 'xgallery-ui', partialize: (s) => ({ colorMode: s.colorMode, assistantConversationId: s.assistantConversationId }) },
  ),
)
