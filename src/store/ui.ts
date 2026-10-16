import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '../theme/apply'
import type { PageContext, ThemeDraft } from '../api/types'
import type { UiConfig } from '../api/dev'

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
  /** Developer panel: a draft of the site design applied live while editing, and design mode (edit handles on the page). */
  previewUi: Partial<UiConfig> | null
  setPreviewUi: (u: Partial<UiConfig> | null) => void
  designMode: boolean
  setDesignMode: (on: boolean) => void
  /** Set when the server stopped recognising the session; the sign-in page explains it. */
  sessionEnded: boolean
  setSessionEnded: (v: boolean) => void
  toast: { id: number; message: string; tone: 'info' | 'error' | 'success' } | null
  notify: (message: string, tone?: 'info' | 'error' | 'success') => void
  dismissToast: () => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      colorMode: 'light',
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
      previewUi: null,
      setPreviewUi: (previewUi) => set({ previewUi }),
      designMode: false,
      setDesignMode: (designMode) => set({ designMode }),
      sessionEnded: false,
      setSessionEnded: (sessionEnded) => set({ sessionEnded }),
      toast: null,
      notify: (message, tone = 'info') => set({ toast: { id: Date.now(), message, tone } }),
      dismissToast: () => set({ toast: null }),
    }),
    {
      name: 'xgallery-ui',
      version: 2,
      partialize: (s) => ({ colorMode: s.colorMode, assistantConversationId: s.assistantConversationId }),
      // v2: light is the default for everyone; a mode persisted before that is reset once (the toggle still works afterwards).
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as { colorMode?: ColorMode; assistantConversationId?: number | null }
        return { colorMode: version < 2 ? 'light' : (p.colorMode ?? 'light'), assistantConversationId: p.assistantConversationId ?? null }
      },
    },
  ),
)
