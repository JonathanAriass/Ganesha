import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { makeSessionSaver, toSessionTabs } from './session-save'
import { unwrap } from './result'

const SAVE_THROTTLE_MS = 500

/**
 * Session persistence: restore the saved tab strip once at boot, then mirror
 * every tab-strip change back to disk (throttled). Mount exactly once (AppShell).
 */
export function useSessionPersistence(): void {
  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    const saver = makeSessionSaver((tabs) => {
      void window.api.session.saveTabs(tabs).catch(() => {})
    })

    window.api.session
      .tabs()
      .then(unwrap)
      .then((tabs) => {
        if (cancelled) return
        // Disk truth, recorded BEFORE hydrating: if hydrate no-ops (the user
        // already opened a tab), their state differs from disk and still saves.
        saver.seedFromDisk(tabs)
        useAppStore.getState().hydrateTabs(tabs)
      })
      .catch(() => {}) // a failed restore must never block the app

    const save = (): void => {
      const s = useAppStore.getState()
      saver.save(toSessionTabs(s.tabs, s.activeTabByPane))
    }

    const unsubscribe = useAppStore.subscribe((s, prev) => {
      // Only tab-strip / per-pane-active changes matter here.
      if (s.tabs === prev.tabs && s.activeTabByPane === prev.activeTabByPane) return
      // Throttle, not debounce: an armed timer is never pushed back, so the
      // result churn of a long script can't starve an edit's save. save()
      // reads live state at fire time, so later changes in the window ride along.
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        save()
      }, SAVE_THROTTLE_MS)
    })

    // Quitting inside the throttle window must not lose the last edit.
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
