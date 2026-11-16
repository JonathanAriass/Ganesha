import { DENSITIES, type Density } from '@shared/domain'

export type { Density }

/** Same precedent as theme.ts / side-panel.ts: the sqlite setting is the source of truth, a
 *  localStorage hint lets the first paint match. Storage is injectable and never touched at
 *  module load, so this imports cleanly in node-env tests. */
const DENSITY_HINT_KEY = 'density-hint'

type ReadStore = Pick<Storage, 'getItem'>
type WriteStore = Pick<Storage, 'setItem'>

function safeLocal(): (ReadStore & WriteStore) | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // the accessor itself throws when storage is blocked
  }
}

/** The two metrics JS needs (everything else is CSS tokens). */
export const DENSITY_METRICS: Record<Density, { editorFontSize: number; gridRowHeight: number }> = {
  comfortable: { editorFontSize: 14, gridRowHeight: 40 },
  compact: { editorFontSize: 13, gridRowHeight: 26 }
}

export function parseDensity(raw: unknown): Density {
  return DENSITIES.find((d) => d === raw) ?? 'comfortable'
}

/** Never throws: useDensity calls this during render while the settings load. */
export function densityHint(storage: ReadStore | null = safeLocal()): Density {
  try {
    return parseDensity(storage?.getItem(DENSITY_HINT_KEY))
  } catch {
    return parseDensity(null)
  }
}

export function applyDensity(d: Density, storage: WriteStore | null = safeLocal()): void {
  document.documentElement.dataset.density = d
  storage?.setItem(DENSITY_HINT_KEY, d)
}
