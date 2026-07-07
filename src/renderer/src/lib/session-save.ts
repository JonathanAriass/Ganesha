import type { SessionTab } from '@shared/domain'
import type { PaneId } from './panes'
import type { QueryTabData } from '../state/store'

/** Project the tab strip onto its persisted shape — text only, volatile state stays out.
 *  Only query tabs persist; diagram and table-info tabs are ephemeral. Each pane's active tab
 *  is flagged. */
export function toSessionTabs(
  tabs: QueryTabData[],
  activeByPane: Record<PaneId, string | null>
): SessionTab[] {
  return tabs
    .filter((t) => (t.kind ?? 'query') === 'query')
    .map((t) => ({
      id: t.id,
      connectionId: t.connectionId,
      title: t.title,
      text: t.text,
      pane: t.pane,
      active: t.id === activeByPane[t.pane],
    }))
}

export interface SessionSaver {
  /** Record what disk holds, so the boot echo doesn't re-write it. No-ops after
   *  any real save — a save that beat a slow restore is fresher than disk. */
  seedFromDisk: (tabs: SessionTab[]) => void
  /** Write `tabs` unless they fingerprint-match the last known disk state. */
  save: (tabs: SessionTab[]) => void
}

/**
 * Fingerprint-guarded writer: skips result churn, the boot echo, and — by
 * starting from an EMPTY baseline — any flush fired before the restore
 * resolved (or after it failed). Without that baseline, quitting inside the
 * boot round-trip would write [] over the very session being restored.
 */
export function makeSessionSaver(write: (tabs: SessionTab[]) => void): SessionSaver {
  let lastSaved = '[]'
  let savedOnce = false
  return {
    seedFromDisk: (tabs) => {
      if (!savedOnce) lastSaved = JSON.stringify(tabs)
    },
    save: (tabs) => {
      const json = JSON.stringify(tabs)
      if (json === lastSaved) return
      lastSaved = json
      savedOnce = true
      write(tabs)
    },
  }
}
