# Focus Mode UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the app shell into "Focus Mode": a slim icon rail with a collapsible, resizable, switchable side panel; a global command bar + status bar replacing the per-tab toolbar; and a slide-in assistant overlay — per `docs/superpowers/specs/2026-08-19-focus-mode-ui-redesign-design.md` (visual reference: `ui-mocks/focus.html`).

**Architecture:** Pure preference libs (`side-panel.ts`, `tab-actions.ts`) + zustand store fields drive three new components (`Rail`, `SidePanel`, `StatusBar`) and modifications to `App`, `TopBar`, `QueryTab`, `AssistantPanel`. All styling uses the existing theme variables so the 10 themes need zero per-theme edits. Each task ships independently with tests green.

**Tech Stack:** React 18 + TypeScript, zustand, vitest, plain CSS (`styles.css`), Electron renderer (sandboxed — `localStorage` for UI prefs).

**Conventions for every task:** run `source ~/.nvm/nvm.sh && nvm use 20.19.4` first. Quality gate before each commit: `npm run typecheck && npx vitest run <touched test files>`; full `npm test` at the end of Tasks 4, 7, 8, 9, 10. Never touch `app.getName()`/`package.json name` (safeStorage).

---

## File map

| File | Action | Why |
|---|---|---|
| `src/renderer/src/lib/side-panel.ts` (+test) | Create | side-panel width/open/section prefs (pure) |
| `src/renderer/src/lib/tab-actions.ts` (+test) | Create | per-tab run/runAll/refresh handler registry |
| `src/renderer/src/state/store.ts` (+store.test.ts) | Modify | `sideOpen`, `sideSection`, `toggleSide`, `selectSideSection` |
| `src/renderer/src/lib/shortcuts.ts` (+test), `lib/use-global-shortcuts.ts` | Modify | ⌘B → `toggle-side` |
| `src/renderer/src/components/icons.tsx` | Modify | add `db`, `bookmark`, `clock`, `panel` icons |
| `src/renderer/src/components/Rail.tsx` | Create | 52px icon rail |
| `src/renderer/src/components/SidePanel.tsx` | Create | resizable one-section-at-a-time panel |
| `src/renderer/src/components/SavedSection.tsx`, `HistorySection.tsx` | Modify | `hosted` prop (no `<details>` inside the panel) |
| `src/renderer/src/components/StatusBar.tsx` | Create | footer status (moved from qt-toolbar `statusEl`) |
| `src/renderer/src/components/TopBar.tsx` | Modify | command cluster (Run/Run all/↻/☆/Cancel) |
| `src/renderer/src/components/QueryTab.tsx` | Modify | remove qt-toolbar/statusEl; register tab actions |
| `src/renderer/src/components/AssistantPanel.tsx` | Modify | slide-in overlay + peek |
| `src/renderer/src/App.tsx` | Modify | rail + panel + status bar mounting |
| `src/renderer/src/styles.css` | Modify | rail/panel/statusbar/overlay/polish CSS |
| `README.md` | Modify | ⌘B shortcut row; "editor toolbar" → "command bar" |

---

### Task 1: `lib/side-panel.ts` — side-panel preferences (pure lib)

**Files:**
- Create: `src/renderer/src/lib/side-panel.ts`
- Test: `src/renderer/src/lib/side-panel.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/src/lib/side-panel.test.ts
import { describe, it, expect } from 'vitest'
import {
  clampSideWidth, dragSideWidth, loadSideWidth, saveSideWidth,
  loadSideOpen, saveSideOpen, loadSideSection, saveSideSection,
  SIDE_DEFAULT_WIDTH, SIDE_MIN_WIDTH, SIDE_MAX_WIDTH
} from './side-panel'

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('clampSideWidth', () => {
  it('clamps into range and rounds', () => {
    expect(clampSideWidth(100)).toBe(SIDE_MIN_WIDTH)
    expect(clampSideWidth(9999)).toBe(SIDE_MAX_WIDTH)
    expect(clampSideWidth(300.6)).toBe(301)
  })
  it('heals garbage to the default', () => {
    expect(clampSideWidth(NaN)).toBe(SIDE_DEFAULT_WIDTH)
    expect(clampSideWidth(Infinity)).toBe(SIDE_DEFAULT_WIDTH)
  })
})

describe('dragSideWidth', () => {
  // Left-docked panel: width = pointer − the panel's fixed LEFT edge.
  it('derives width from pointer minus panel left', () => {
    expect(dragSideWidth(352, 52)).toBe(300)
  })
  it('clamps the derived width', () => {
    expect(dragSideWidth(5000, 52)).toBe(SIDE_MAX_WIDTH)
  })
})

describe('width persistence', () => {
  it('defaults when unset, round-trips, clamps stored garbage', () => {
    const s = memStorage()
    expect(loadSideWidth(s)).toBe(SIDE_DEFAULT_WIDTH)
    saveSideWidth(333, s)
    expect(loadSideWidth(s)).toBe(333)
    expect(loadSideWidth(memStorage({ 'side-width': 'junk' }))).toBe(SIDE_DEFAULT_WIDTH)
  })
})

describe('open/section persistence', () => {
  it('open defaults true; only the literal "false" closes it', () => {
    expect(loadSideOpen(memStorage())).toBe(true)
    expect(loadSideOpen(memStorage({ 'side-open': 'false' }))).toBe(false)
    expect(loadSideOpen(memStorage({ 'side-open': 'garbage' }))).toBe(true)
    const s = memStorage()
    saveSideOpen(false, s)
    expect(loadSideOpen(s)).toBe(false)
  })
  it('section defaults to schema and rejects unknown values', () => {
    expect(loadSideSection(memStorage())).toBe('schema')
    expect(loadSideSection(memStorage({ 'side-section': 'saved' }))).toBe('saved')
    expect(loadSideSection(memStorage({ 'side-section': 'bogus' }))).toBe('schema')
    const s = memStorage()
    saveSideSection('history', s)
    expect(loadSideSection(s)).toBe('history')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/lib/side-panel.test.ts`
Expected: FAIL — cannot resolve `./side-panel`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/lib/side-panel.ts
/** Side-panel (rail-opened schema/saved/history panel) UI preferences.
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

/** Left-docked panel: its LEFT edge (after the rail) is fixed during a drag,
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
```

- [ ] **Step 4: Run to verify pass** — same command, expect all green.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/side-panel.ts src/renderer/src/lib/side-panel.test.ts
git commit -m "feat(ui): side-panel preference lib (width/open/section, storage-injectable)"
```

---

### Task 2: Store — `sideOpen` / `sideSection`

**Files:**
- Modify: `src/renderer/src/state/store.ts` (near `assistantOpen`, line ~174, initial state ~367, actions ~421)
- Test: `src/renderer/src/state/store.test.ts` (append a describe block)

- [ ] **Step 1: Failing tests** — append to `store.test.ts` (uses the file's existing `useAppStore` import):

```ts
describe('side panel state', () => {
  it('defaults: open with the schema section', () => {
    const s = useAppStore.getState()
    expect(s.sideOpen).toBe(true)
    expect(s.sideSection).toBe('schema')
  })
  it('toggleSide flips open', () => {
    const before = useAppStore.getState().sideOpen
    useAppStore.getState().toggleSide()
    expect(useAppStore.getState().sideOpen).toBe(!before)
    useAppStore.getState().toggleSide()
    expect(useAppStore.getState().sideOpen).toBe(before)
  })
  it('selectSideSection: opens when closed, switches when different, collapses on re-click', () => {
    useAppStore.setState({ sideOpen: false, sideSection: 'schema' })
    useAppStore.getState().selectSideSection('saved')       // closed → open + switch
    expect(useAppStore.getState()).toMatchObject({ sideOpen: true, sideSection: 'saved' })
    useAppStore.getState().selectSideSection('history')      // open, different → switch
    expect(useAppStore.getState()).toMatchObject({ sideOpen: true, sideSection: 'history' })
    useAppStore.getState().selectSideSection('history')      // open, same → collapse
    expect(useAppStore.getState()).toMatchObject({ sideOpen: false, sideSection: 'history' })
  })
})
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/state/store.test.ts` — expect the new block FAILS (`sideOpen` undefined).
- [ ] **Step 3: Implement in `store.ts`** — three edits:

(a) In the `AppState` interface next to `assistantOpen: boolean` (~line 174):

```ts
  /** Focus Mode side panel (rail-opened schema/saved/history). Persisted to localStorage. */
  sideOpen: boolean
  sideSection: SideSection
```

and next to `toggleAssistant: () => void` (~line 201):

```ts
  toggleSide: () => void
  /** Rail click: closed → open on that section; open+different → switch; open+same → collapse. */
  selectSideSection: (section: SideSection) => void
```

(b) Import at the top of `store.ts`:

```ts
import { loadSideOpen, saveSideOpen, loadSideSection, saveSideSection, type SideSection } from '../lib/side-panel'
```

(c) Initial state next to `assistantOpen: false` (~line 367):

```ts
  sideOpen: loadSideOpen(),
  sideSection: loadSideSection(),
```

and actions next to `toggleAssistant` (~line 421):

```ts
  toggleSide: () =>
    set((s) => {
      saveSideOpen(!s.sideOpen)
      return { sideOpen: !s.sideOpen }
    }),
  selectSideSection: (section) =>
    set((s) => {
      if (s.sideOpen && s.sideSection === section) {
        saveSideOpen(false)
        return { sideOpen: false }
      }
      saveSideOpen(true)
      saveSideSection(section)
      return { sideOpen: true, sideSection: section }
    }),
```

- [ ] **Step 4: Run** the store tests — all green (existing tests untouched: the new fields are top-level, not per-tab).
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): side-panel open/section state in the store (persisted)"`

---

### Task 3: ⌘B toggles the side panel

**Files:**
- Modify: `src/renderer/src/lib/shortcuts.ts`, `src/renderer/src/lib/use-global-shortcuts.ts`
- Test: `src/renderer/src/lib/shortcuts.test.ts`

- [ ] **Step 1: Failing test** — append to `shortcuts.test.ts` (match its existing chord-helper style; if it builds chords inline, mirror that):

```ts
it('⌘B / Ctrl+B toggles the side panel', () => {
  expect(resolveShortcut({ key: 'b', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe('toggle-side')
  expect(resolveShortcut({ key: 'B', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe('toggle-side')
})
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/shortcuts.test.ts` — FAIL.
- [ ] **Step 3: Implement** — in `shortcuts.ts` extend the union and switch:

```ts
export type ShortcutAction = 'palette' | 'new-tab' | 'close-tab' | 'settings' | 'commit-edits' | 'toggle-side'
```

```ts
    case 'b':
      return 'toggle-side'
```

In `use-global-shortcuts.ts`, add a case to the action switch:

```ts
        case 'toggle-side':
          s.toggleSide()
          break
```

- [ ] **Step 4: Run** shortcuts tests + `npm run typecheck:web` — green.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): ⌘B/Ctrl+B toggles the side panel"`

---### Task 4: Rail + SidePanel components, App rewire, CSS

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`
- Create: `src/renderer/src/components/Rail.tsx`, `src/renderer/src/components/SidePanel.tsx`
- Modify: `src/renderer/src/components/SavedSection.tsx`, `HistorySection.tsx` (add `hosted` prop)
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1: Add icons** — in `icons.tsx` `ICONS` map, before the closing `} as const`:

```tsx
  db: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
      <path d="M5 5.5v13c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-13M5 12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8" />
    </>
  ),
  bookmark: <path d="M6 3.5h12v17l-6-3.6-6 3.6v-17Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </>
  ),
```

- [ ] **Step 2: `Rail.tsx`**

```tsx
// src/renderer/src/components/Rail.tsx
import { useAppStore } from '../state/store'
import { mod } from '../lib/platform'
import { Icon } from './icons'
import type { SideSection } from '../lib/side-panel'

/** The Focus Mode icon rail: switches/collapses the side panel and opens the
 *  diagram tab. Content sections live in SidePanel; this is pure navigation. */
export default function Rail(): JSX.Element {
  const sideOpen = useAppStore((s) => s.sideOpen)
  const sideSection = useAppStore((s) => s.sideSection)
  const selectSideSection = useAppStore((s) => s.selectSideSection)
  const toggleSide = useAppStore((s) => s.toggleSide)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openDiagramTab = useAppStore((s) => s.openDiagramTab)

  const sections: Array<{ id: SideSection; icon: 'db' | 'bookmark' | 'clock'; label: string }> = [
    { id: 'schema', icon: 'db', label: 'Schema' },
    { id: 'saved', icon: 'bookmark', label: 'Saved queries' },
    { id: 'history', icon: 'clock', label: 'Query history' },
  ]

  return (
    <nav className="rail" aria-label="Sidebar sections">
      {sections.map((s) => (
        <button
          key={s.id}
          className={`rail-btn${sideOpen && sideSection === s.id ? ' active' : ''}`}
          onClick={() => selectSideSection(s.id)}
          aria-label={s.label}
          aria-pressed={sideOpen && sideSection === s.id}
          data-tooltip={s.label}
          data-tip="rail"
        >
          <Icon name={s.icon} size={18} />
        </button>
      ))}
      <button
        className="rail-btn"
        disabled={!activeConnectionId}
        onClick={() => activeConnectionId && openDiagramTab(activeConnectionId)}
        aria-label="Schema diagram"
        data-tooltip="Schema diagram"
        data-tip="rail"
      >
        <Icon name="diagram" size={18} />
      </button>
      <span className="rail-spacer" />
      <button
        className="rail-btn"
        onClick={toggleSide}
        aria-label={sideOpen ? 'Collapse side panel' : 'Expand side panel'}
        aria-pressed={sideOpen}
        data-tooltip={`${sideOpen ? 'Collapse' : 'Expand'} panel (${mod}B)`}
        data-tip="rail"
      >
        <Icon name="panel" size={18} />
      </button>
    </nav>
  )
}
```

- [ ] **Step 3: `hosted` prop on SavedSection/HistorySection** — in both files change the signature and the wrapper only. `SavedSection.tsx`:

```tsx
export default function SavedSection({ hosted = false }: { hosted?: boolean } = {}): JSX.Element | null {
```

and replace the `<details className="history">…</details>` wrapper: extract the children into a variable and return

```tsx
  const body = (
    <>
      {/* …existing children exactly as they are today (error rows, empty row, snippets map)… */}
    </>
  )
  if (hosted) return <div className="panel-section">{body}</div>
  return (
    <details className="history">
      <summary>Saved</summary>
      {body}
    </details>
  )
```

Do the same in `HistorySection.tsx` (summary text `History`). Also update SavedSection's empty-state string (it references a toolbar that Task 7 removes):

```tsx
        <div className="h-empty">Nothing saved yet — ☆ Save in the command bar</div>
```

- [ ] **Step 4: `SidePanel.tsx`**

```tsx
// src/renderer/src/components/SidePanel.tsx
import { useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import ObjectTree from './ObjectTree'
import SavedSection from './SavedSection'
import HistorySection from './HistorySection'
import {
  clampSideWidth, dragSideWidth, loadSideWidth, saveSideWidth,
  SIDE_DEFAULT_WIDTH, SIDE_MIN_WIDTH, SIDE_MAX_WIDTH
} from '../lib/side-panel'

const TITLES = { schema: 'Schema', saved: 'Saved queries', history: 'History' } as const

/** Rail-opened panel: one section at a time, right-edge drag to resize.
 *  Resize mirrors AssistantPanel: DOM write during drag, commit on release. */
export default function SidePanel(): JSX.Element | null {
  const open = useAppStore((s) => s.sideOpen)
  const section = useAppStore((s) => s.sideSection)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)

  const panelRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(() => loadSideWidth())
  const widthRef = useRef(width)
  function commitWidth(w: number): void {
    widthRef.current = w
    setWidth(w)
    saveSideWidth(w)
  }
  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    panelRef.current.style.width = `${dragSideWidth(e.clientX, panelRef.current.getBoundingClientRect().left)}px`
  }
  function onResizePointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    commitWidth(clampSideWidth(panelRef.current.getBoundingClientRect().width))
  }
  function onResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    // Right edge of a LEFT-docked panel: ArrowRight widens, ArrowLeft narrows.
    const step = e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : null
    if (step === null) return
    e.preventDefault()
    commitWidth(clampSideWidth(widthRef.current + step))
  }

  if (!open) return null

  return (
    <aside className="side-panel" ref={panelRef} style={{ width }} aria-label={TITLES[section]}>
      <div className="side-head">{TITLES[section]}</div>
      <div className="side-body">
        {section === 'schema' && <ObjectTree />}
        {section === 'saved' &&
          (activeConnectionId ? <SavedSection hosted /> : <div className="sidebar-empty"><p>No connection selected.</p></div>)}
        {section === 'history' &&
          (activeConnectionId ? <HistorySection hosted /> : <div className="sidebar-empty"><p>No connection selected.</p></div>)}
      </div>
      <div
        className="side-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        aria-valuemin={SIDE_MIN_WIDTH}
        aria-valuemax={SIDE_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title="Drag to resize · double-click to reset · ←/→ to adjust"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        onPointerCancel={onResizePointerEnd}
        onDoubleClick={() => commitWidth(SIDE_DEFAULT_WIDTH)}
        onKeyDown={onResizeKeyDown}
      />
    </aside>
  )
}
```

- [ ] **Step 5: App.tsx** — replace the `<aside className="sidebar">…</aside>` block (lines 79–85) with:

```tsx
        <Rail />
        <SidePanel />
```

Add imports `import Rail from './components/Rail'` and `import SidePanel from './components/SidePanel'`; remove now-unused imports `ObjectTree`, `SavedSection`, `HistorySection` from App.tsx.

- [ ] **Step 6: CSS** — in `styles.css`: change `--topbar-h: 38px;` → `--topbar-h: 46px;` and add below it `--rail-w: 52px; --statusbar-h: 26px;`. Delete the `.sidebar { … }` block (keep `.sidebar-empty`). Add:

```css
/* ── Focus Mode: icon rail + side panel ── */
.rail {
  width: var(--rail-w);
  flex-shrink: 0;
  background: var(--bg-2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
  gap: 4px;
}
.rail-spacer { flex: 1; }
.rail-btn {
  width: 38px; height: 38px;
  display: grid; place-items: center;
  background: none; border: none; border-radius: var(--radius);
  color: var(--text-2); cursor: pointer; position: relative;
  transition: color 0.12s, background 0.12s;
}
.rail-btn:hover { color: var(--text); background: var(--btn-hover-bg); }
.rail-btn:disabled { opacity: 0.4; cursor: default; }
.rail-btn.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.rail-btn.active::before {
  content: ""; position: absolute; left: -7px; top: 50%; transform: translateY(-50%);
  width: 3px; height: 20px; border-radius: 0 3px 3px 0; background: var(--accent);
}
/* rail tooltips fly right, not below (the bar is vertical) */
[data-tip='rail']::after { top: 50%; left: calc(100% + 8px); transform: translateY(-50%); }

.side-panel {
  position: relative; flex-shrink: 0;
  background: var(--bg-2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.side-head {
  padding: 8px 12px 6px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-2); flex-shrink: 0;
}
.side-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
.side-resizer {
  position: absolute; right: 0; top: 0; bottom: 0; width: 6px; z-index: 2;
  cursor: col-resize; touch-action: none;
  background: linear-gradient(var(--border), var(--border)) right / 1px 100% no-repeat;
}
.side-resizer:hover, .side-resizer:focus-visible {
  background: linear-gradient(var(--accent), var(--accent)) right / 2px 100% no-repeat; outline: none;
}
.panel-section { display: flex; flex-direction: column; }
```

- [ ] **Step 7: Verify** — `npm run typecheck && npm test` green; then `npm run dev` manual check: rail renders, sections switch, re-click collapses, ⌘B toggles, right-edge drag resizes and persists across restart, tree/saved/history all work, no-connection states sane. Verify 2–3 themes (Settings → theme).
- [ ] **Step 8: Commit** — `git commit -m "feat(ui): Focus Mode icon rail + collapsible resizable side panel"`

---

### Task 5: `lib/tab-actions.ts` — per-tab handler registry

**Files:**
- Create: `src/renderer/src/lib/tab-actions.ts`
- Test: `src/renderer/src/lib/tab-actions.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/renderer/src/lib/tab-actions.test.ts
import { describe, it, expect, vi } from 'vitest'
import { setTabActions, clearTabActions, getTabActions } from './tab-actions'

const mk = () => ({ run: vi.fn(), runAll: vi.fn(), refresh: vi.fn() })

describe('tab-actions registry', () => {
  it('returns the registered actions and calls through', () => {
    const a = mk()
    setTabActions('t1', () => a)
    getTabActions('t1')?.run()
    expect(a.run).toHaveBeenCalledOnce()
    clearTabActions('t1')
  })
  it('is null for unknown or cleared tabs', () => {
    expect(getTabActions('nope')).toBeNull()
    setTabActions('t2', () => mk())
    clearTabActions('t2')
    expect(getTabActions('t2')).toBeNull()
  })
  it('always reads the latest thunk result (ref pattern)', () => {
    let current = mk()
    setTabActions('t3', () => current)
    const first = current
    current = mk()
    getTabActions('t3')?.refresh()
    expect(first.refresh).not.toHaveBeenCalled()
    expect(current.refresh).toHaveBeenCalledOnce()
    clearTabActions('t3')
  })
})
```

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// src/renderer/src/lib/tab-actions.ts
/** Imperative run handlers for each mounted QueryTab, so the global command bar
 *  can drive the focused tab. Same thunk-registry pattern as the Monaco
 *  completion ctxByModel map: QueryTab registers a getter that reads a ref, so
 *  the registry always sees the freshest closures without re-registering. */

export interface TabActions {
  /** ⌘↵ semantics: selection → statement at cursor → whole tab. */
  run: () => void
  runAll: () => void
  /** Re-run lastRunText (the Refresh button). */
  refresh: () => void
}

const byTab = new Map<string, () => TabActions>()

export function setTabActions(tabId: string, get: () => TabActions): void {
  byTab.set(tabId, get)
}

export function clearTabActions(tabId: string): void {
  byTab.delete(tabId)
}

export function getTabActions(tabId: string): TabActions | null {
  return byTab.get(tabId)?.() ?? null
}
```

- [ ] **Step 4: Run** — green. **Step 5: Commit** — `git commit -m "feat(ui): per-tab action registry for the global command bar"`

---

### Task 6: Command cluster in TopBar + QueryTab registration + qt-toolbar removal

**Files:**
- Modify: `src/renderer/src/components/QueryTab.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1: QueryTab — register actions, drop the toolbar.**
  1. Add import: `import { setTabActions, clearTabActions } from '../lib/tab-actions'`.
  2. Below the `refresh()` definition add:

```tsx
  // Expose run handlers to the global command bar (TopBar). Ref-thunk so the
  // registry always sees this render's closures; registered once per mount.
  const actionsRef = useRef({ run: () => run(), runAll: () => void runAll(), refresh })
  actionsRef.current = { run: () => run(), runAll: () => void runAll(), refresh }
  useEffect(() => {
    setTabActions(tab.id, () => actionsRef.current)
    return () => clearTabActions(tab.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tab.id is stable for a mounted tab
  }, [])
```

  3. Delete the whole `<div className="qt-toolbar">…</div>` JSX block (Run/Run all/Refresh/Save/Cancel buttons, conn-chip, `{statusEl}`) from the return.
  4. Delete the `statusEl` computation block (`let statusEl … tab.error) { … }`).
  5. Delete now-dead code: the `cancelQuery` usages (`useCancelQuery()` call, the `cancelQuery.reset()` line in `run()`), `openSaveQueryModal` selector, `requestScriptStop` selector, and imports `mod`, `rowCountLabel`, `affectedRowsLabel`, `useCancelQuery` (keep everything else — `runAll`'s transaction guard still uses `finishRun`).

- [ ] **Step 2: TopBar — the cluster.** Add imports:

```tsx
import { useCancelQuery } from '../lib/hooks'   // merge into the existing hooks import
import { getTabActions } from '../lib/tab-actions'
```

Add selectors + the focused-tab lookup inside the component:

```tsx
  const openSaveQueryModal = useAppStore((s) => s.openSaveQueryModal)
  const requestScriptStop = useAppStore((s) => s.requestScriptStop)
  // The tab the command bar drives: the focused pane's active QUERY tab.
  const tab = useAppStore((s) => {
    const id = s.activeTabByPane[s.focusedPane]
    const t = id ? s.tabs.find((x) => x.id === id) ?? null : null
    return t && (t.kind ?? 'query') === 'query' ? t : null
  })
  const cancelQuery = useCancelQuery()
```

Insert the cluster right after `<span className="spacer" />`:

```tsx
      {tab && (
        <div className="cmd-cluster">
          <button
            className="btn xs"
            disabled={tab.running || !tab.lastRunText}
            onClick={() => getTabActions(tab.id)?.refresh()}
            title="Refresh — re-run the current query"
          >
            ↻
          </button>
          <button
            className="btn xs"
            disabled={!tab.text.trim()}
            onClick={() => openSaveQueryModal({ mode: 'create', connectionId: tab.connectionId, query: tab.text })}
            title="Save query to favourites"
          >
            ☆
          </button>
          <button
            className="btn xs"
            disabled={tab.running || !tab.text.trim()}
            onClick={() => getTabActions(tab.id)?.runAll()}
            title={`Run all statements (${mod}⇧↵)`}
          >
            ▶▶
          </button>
          {tab.running && tab.queryId ? (
            <button
              className="btn xs"
              onClick={() => {
                if (tab.scriptRun) requestScriptStop(tab.id)
                cancelQuery.mutate({ connectionId: tab.connectionId, queryId: tab.queryId! })
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              className="btn xs primary"
              disabled={tab.running || !tab.text.trim()}
              onClick={() => getTabActions(tab.id)?.run()}
              title={`Run (${mod}↵) — selection, else statement at cursor`}
            >
              ▶ Run
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 3: CSS** — add:

```css
.cmd-cluster { display: flex; align-items: center; gap: 6px; margin-right: 4px; }
/* subtle focused-pane cue: the command bar drives THIS pane */
.editor-pane.focused { box-shadow: inset 0 2px 0 var(--accent); }
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm test`; dev check: Run/Run all/↻/☆/Cancel all work from the top bar against the focused pane (test in split view!), diagram/telescope tab focused → cluster hidden, ⌘↵ still works in the editor.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): global command bar drives the focused tab; drop the per-tab toolbar"`

---

### Task 7: StatusBar

**Files:**
- Create: `src/renderer/src/components/StatusBar.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1: Component** (the old `statusEl` logic, verbatim semantics minus the cancel-error line):

```tsx
// src/renderer/src/components/StatusBar.tsx
import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { rowCountLabel, affectedRowsLabel } from '../lib/result-label'

/** Focus Mode footer: the focused tab's run status + connection identity.
 *  Logic moved from QueryTab's old qt-toolbar statusEl. */
export default function StatusBar(): JSX.Element {
  const tab = useAppStore((s) => {
    const id = s.activeTabByPane[s.focusedPane]
    return id ? s.tabs.find((x) => x.id === id) ?? null : null
  })
  const connId = useAppStore((s) => s.activeConnByPane[s.focusedPane] ?? s.activeConnectionId)
  const { data: connections = [] } = useConnections()
  const conn = connections.find((c) => c.id === connId) ?? null

  let statusEl: JSX.Element | null = null
  const isQuery = tab && (tab.kind ?? 'query') === 'query'
  if (isQuery && tab.running) {
    statusEl = (
      <span className="sb-status">
        {tab.scriptRun
          ? `Running statement ${Math.min(tab.scriptRun.entries.length + 1, tab.scriptRun.total)} of ${tab.scriptRun.total}…`
          : 'Running…'}
      </span>
    )
  } else if (isQuery && tab.scriptRun) {
    const { entries, total } = tab.scriptRun
    const failedAt = entries.findIndex((e) => e.error !== null)
    const ran = entries.filter((e) => !e.skipped).length
    const ms = entries.reduce((acc, e) => acc + (e.result?.durationMs ?? 0), 0)
    statusEl =
      failedAt !== -1 ? (
        <span className="sb-status err">failed at statement {failedAt + 1} of {total}</span>
      ) : ran < total ? (
        <span className="sb-status err">canceled — ran {ran} of {total} statements</span>
      ) : (
        <span className="sb-status">{total} statements · {ms} ms</span>
      )
  } else if (isQuery && tab.result) {
    const label = tab.result.columns.length === 0 ? affectedRowsLabel(tab.result) : rowCountLabel(tab.result)
    statusEl = <span className="sb-status">✓ {label} · {tab.result.durationMs} ms</span>
  } else if (isQuery && tab.error) {
    statusEl = <span className="sb-status err" title={tab.error}>{tab.error}</span>
  }

  return (
    <footer className="statusbar">
      {statusEl}
      <span className="spacer" />
      {conn && (
        <span className="sb-conn">
          <span className="conn-dot" style={{ background: conn.color }} aria-hidden="true" />
          {conn.name}
          {conn.readOnly && <span title="Read-only connection"> 🔒</span>}
        </span>
      )}
    </footer>
  )
}
```

- [ ] **Step 2: Mount + CSS.** In `App.tsx` add `import StatusBar from './components/StatusBar'` and place `<StatusBar />` directly after the closing `</div>` of `.app-body`. CSS:

```css
.statusbar {
  height: var(--statusbar-h);
  display: flex; align-items: center; gap: 12px;
  padding: 0 12px;
  background: var(--bg-2); border-top: 1px solid var(--border);
  flex-shrink: 0; font-size: 11.5px; color: var(--text-2); user-select: none;
}
.sb-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sb-status.err { color: var(--danger-text); }
.sb-conn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
```

- [ ] **Step 3: Verify** — typecheck + tests + dev check (status follows the focused pane; errors truncate with a hover title; diagram tab shows just the connection).
- [ ] **Step 4: Commit** — `git commit -m "feat(ui): status bar footer (run status moved from the per-tab toolbar)"`

---

### Task 8: Assistant slide-in overlay + peek

**Files:**
- Modify: `src/renderer/src/components/AssistantPanel.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1: Component.** Replace the early return `if (!open) return null` with nothing (delete it), and change the return to a fragment with the peek + `open` class:

```tsx
  return (
    <>
      {!open && (
        <button className="assistant-peek" onClick={toggle} aria-label="Open assistant">
          <span className="assistant-peek-label">✦ Assistant</span>
        </button>
      )}
      <aside
        className={`assistant-panel${open ? ' open' : ''}`}
        ref={panelRef}
        style={{ width }}
        aria-hidden={!open}
      >
        {/* …existing panel children UNCHANGED (resizer, head, thread, input)… */}
      </aside>
    </>
  )
```

- [ ] **Step 2: CSS.** Replace the `.assistant-panel { … }` rule with the overlay version and add the peek:

```css
.assistant-panel {
  position: fixed; top: var(--topbar-h); right: 0; bottom: var(--statusbar-h);
  z-index: 900; /* below modals (1000) and the palette (1100) */
  display: flex; flex-direction: column; min-height: 0;
  max-width: calc(100vw - 480px);
  border-left: 1px solid var(--border); background: var(--bg-2);
  box-shadow: -14px 0 44px -18px rgba(0, 0, 0, 0.5);
  transform: translateX(calc(100% + 16px)); /* +16 hides the shadow too */
  transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.assistant-panel.open { transform: none; }
.assistant-peek {
  position: fixed; right: 0; top: calc(var(--topbar-h) + 56px); z-index: 899;
  padding: 12px 6px; background: var(--bg-2); color: var(--accent);
  border: 1px solid var(--border); border-right: none; border-radius: 8px 0 0 8px;
  cursor: pointer; box-shadow: -6px 4px 18px -8px rgba(0, 0, 0, 0.45);
}
.assistant-peek:hover { background: var(--btn-hover-bg); }
.assistant-peek-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 11px; font-weight: 600; letter-spacing: 0.4px; }
```

Note: the panel now stays mounted while closed — its react-query reads are cached and the token subscription is already keyed by request id, so this is safe; streaming continues into a hidden panel rather than being lost.

- [ ] **Step 3: Verify** — typecheck + tests; dev check: peek shows when closed, slide animation both ways, resize still works, TopBar toggle still works, panel doesn't cover modals/palette, statusbar stays visible below it, SSM panel still renders (overlap acceptable per spec).
- [ ] **Step 4: Commit** — `git commit -m "feat(ui): assistant becomes a slide-in overlay with an edge peek tab"`

---

### Task 9: Polish + docs

**Files:**
- Modify: `src/renderer/src/styles.css`, `README.md`

- [ ] **Step 1: CSS polish** (all theme-var based):

```css
/* Focus Mode polish */
.topbar { padding: 0 12px; gap: 8px; }
.btn.xs { border-radius: 6px; }
.tabbar-wrap { padding-top: 4px; }
```

Also bump the base `--radius: 6px;` → `--radius: 7px;` in the `:root` block.

- [ ] **Step 2: README** — in the Keyboard shortcuts table add `| ⌘B / Ctrl+B | Toggle the side panel |`, and re-word the Features line that mentions the per-tab toolbar ("☆ Save in the editor toolbar" style references → "the command bar").
- [ ] **Step 3: Full gate** — `npm run typecheck && npm run lint && npm test && npm run build`. Dev sweep across at least 4 themes (midnight, a light one, dracula, gruvbox): rail, panel, command bar, status bar, assistant, split view.
- [ ] **Step 4: Commit** — `git commit -m "polish(ui): Focus Mode spacing/radius pass + docs (⌘B, command bar)"`

---

## Self-review notes

- **Spec coverage:** rail+panel (T4), resizable/collapsible+⌘B (T1–T4), command bar (T5–T6), status bar (T7), assistant overlay (T8), polish+docs (T9). Split view: pre-existing, untouched. Theme constraint: only `var(--…)` colors used. ✓
- **Type consistency:** `SideSection` defined once in `side-panel.ts`, imported by store/Rail; `TabActions` in `tab-actions.ts`; `selectSideSection`/`toggleSide` names match store/Rail/shortcuts. ✓
- **Known judgment calls:** cancel-mutation error display (Atlas killOp edge case) is dropped from status rather than re-plumbed — the Cancel button lives in TopBar with its own mutation instance. QueryTab keeps `mod`-free imports; `runAll`'s transaction-control guard untouched.
