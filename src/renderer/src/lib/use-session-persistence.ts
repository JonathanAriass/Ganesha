import { useEffect } from 'react'
import type { SessionTab } from '@shared/domain'
import { useAppStore, type QueryTabData } from '../state/store'
import { unwrap } from './result'

const SAVE_DEBOUNCE_MS = 500

/** Project the tab strip onto its persisted shape — text only, volatile state stays out. */
function toSessionTabs(tabs: QueryTabData[], activeTabId: string | null): SessionTab[] {
  return tabs.map((t) => ({
    id: t.id,
    connectionId: t.connectionId,
    title: t.title,
    text: t.text,
    active: t.id === activeTabId,
  }))
}

/**
 * Session persistence: restore the saved tab strip once at boot, then mirror
 * every tab-strip change back to disk (debounced). Mount exactly once (AppShell).
 */
export function useSessionPersistence(): void {
  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    // Fingerprint of what disk currently holds. The debounced save compares
    // against it so result churn and the boot echo don't trigger writes.
    let lastSaved = ''

    window.api.session
      .tabs()
      .then(unwrap)
      .then((tabs) => {
        if (cancelled) return
        // Disk truth, recorded BEFORE hydrating: if hydrate no-ops (the user
        // already opened a tab), their state differs from disk and still saves.
        lastSaved = JSON.stringify(tabs)
        useAppStore.getState().hydrateTabs(tabs)
      })
      .catch(() => {}) // a failed restore must never block the app

    const save = (): void => {
      const s = useAppStore.getState()
      const tabs = toSessionTabs(s.tabs, s.activeTabId)
      const json = JSON.stringify(tabs)
      if (json === lastSaved) return
      lastSaved = json
      void window.api.session.saveTabs(tabs).catch(() => {})
    }

    const unsubscribe = useAppStore.subscribe((s, prev) => {
      // Zustand fires on every set(); only tab-strip changes matter here.
      if (s.tabs === prev.tabs && s.activeTabId === prev.activeTabId) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        save()
      }, SAVE_DEBOUNCE_MS)
    })

    // Quitting inside the debounce window must not lose the last edit.
    const flush = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      save()
    }
    window.addEventListener('pagehide', flush)

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
      unsubscribe()
    }
  }, [])
}
