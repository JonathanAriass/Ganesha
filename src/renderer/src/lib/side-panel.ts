/** Connection sidebar UI preferences (width, expanded, explorer section).
 *  Same precedent as assistant-width.ts: localStorage is the source of truth,
 *  every function takes an injectable storage so tests (and the node-env store
 *  module) never touch the real localStorage. */

export type SideSection = 'schema' | 'saved' | 'history'

const WIDTH_KEY = 'side-width'
const OPEN_KEY = 'side-open'
const SECTION_KEY = 'side-section'

export const SIDE_DEFAULT_WIDTH = 264
export const SIDE_MIN_WIDTH = 200
export const SIDE_MAX_WIDTH = 480

type ReadStore = Pick<Storage, 'getItem'>
type WriteStore = Pick<Storage, 'setItem'>

/** The store module loads at import time in node-env tests — no localStorage there. */
function safeLocal(): (ReadStore & WriteStore) | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function clampSideWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDE_DEFAULT_WIDTH
  return Math.round(Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, w)))
}

/** Left-docked panel: its LEFT edge is fixed during a drag,
 *  so width = pointer distance past that edge. */
export function dragSideWidth(clientX: number, panelLeft: number): number {
  return clampSideWidth(clientX - panelLeft)
}

export function loadSideWidth(storage: ReadStore | null = safeLocal()): number {
  const raw = storage?.getItem(WIDTH_KEY)
  if (raw == null) return SIDE_DEFAULT_WIDTH
  return clampSideWidth(Number(raw))
}

export function saveSideWidth(w: number, storage: WriteStore | null = safeLocal()): void {
  storage?.setItem(WIDTH_KEY, String(clampSideWidth(w)))
}

export function loadSideOpen(storage: ReadStore | null = safeLocal()): boolean {
  return storage?.getItem(OPEN_KEY) !== 'false' // default open; anything but "false" = open
}

export function saveSideOpen(open: boolean, storage: WriteStore | null = safeLocal()): void {
  storage?.setItem(OPEN_KEY, String(open))
}

export function loadSideSection(storage: ReadStore | null = safeLocal()): SideSection {
  const raw = storage?.getItem(SECTION_KEY)
  return raw === 'saved' || raw === 'history' ? raw : 'schema'
}

export function saveSideSection(s: SideSection, storage: WriteStore | null = safeLocal()): void {
  storage?.setItem(SECTION_KEY, s)
}
