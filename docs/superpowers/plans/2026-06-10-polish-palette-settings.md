# Plan 4c — Polish: Hardening, Theme, Settings, ⌘K Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 polish layer: main-process navigation hardening + app menu, a native directory-picker IPC channel, a real app icon, a light theme, a Settings modal, a ⌘K command palette, app-wide keyboard shortcuts, and the three 4b carry-ins — then re-verify packaging.

**Architecture:** Two implementation units. **U1 (platform & theme foundation)** touches the main process (window-open/will-navigate hardening, custom application menu that frees ⌘W, `dialog.pickDirectory` channel #20, theme-aware window background), adds `build/` icons, and builds the theme system (CSS token overrides under `:root[data-theme='light']`, a Monaco `daylight` theme, settings hooks, and an `applyTheme` effect). **U2 (UI layer)** builds on U1's hooks/channel: Settings modal, cmdk command palette, capture-phase global shortcuts, and the 4b carry-ins. No schema or driver changes.

**Tech Stack:** Electron `Menu`/`dialog`, CSS custom-property theming + `color-scheme`, monaco `defineTheme`/`setTheme` (global), TanStack Query for settings, `cmdk` ^1.0 for the palette, zustand for overlay state.

**Deliberate non-goals (decided, do not implement):**
- **EJSON `{relaxed: false}` for the documents tree stays deferred.** Canonical mode wraps *every* number as `{"$numberInt": …}` — the readability cost for all documents outweighs the >2^53 precision edge case. Revisit only if a user hits it.
- No per-connection theme, no custom keymap editor, no tray icon.

**State at start:** `main` @ `6238a77` — 61 unit / 12 integration tests, 19 typed IPC channels, lint+typecheck green, app live-verified through Plan 4b.

---

## File structure

```
build/                                    (NEW — electron-builder buildResources)
  icon.svg                                (NEW: vector source, committed)
  icon.png                                (NEW: 1024×1024 raster; electron-builder converts to icns/ico)
src/main/
  index.ts                                (MODIFY: nav hardening, menu install, theme-aware bg)
  menu.ts                                 (NEW: application menu — frees ⌘W for renderer)
  ipc.ts                                  (MODIFY: dialog.pickDirectory handler)
src/shared/
  ipc.ts                                  (MODIFY: +dialog.pickDirectory channel → 20 total)
  api.ts                                  (MODIFY: +dialog.pickDirectory)
src/preload/
  index.ts                                (MODIFY: +dialog.pickDirectory)
src/renderer/src/
  styles.css                              (MODIFY: tokenize hardcoded colors, light theme block, palette/settings CSS)
  main.tsx                                (MODIFY: pre-React theme hint)
  App.tsx                                 (MODIFY: theme effect, shortcuts hook, SettingsModal + CommandPalette mounts)
  lib/monaco.ts                           (MODIFY: daylight theme, MONACO_THEME map, default setTheme)
  lib/theme.ts                            (NEW: themeHint/applyTheme)
  lib/hooks.ts                            (MODIFY: +useSettings/useSetSetting/useDataDir/useSetDataDir)
  lib/shortcuts.ts                        (NEW: pure resolveShortcut)
  lib/shortcuts.test.ts                   (NEW: unit tests)
  lib/use-global-shortcuts.ts             (NEW: capture-phase keydown hook)
  state/store.ts                          (MODIFY: settingsOpen/paletteOpen)
  components/MonacoEditor.tsx             (MODIFY: drop per-editor theme option)
  components/TopBar.tsx                   (MODIFY: settings gear)
  components/SettingsModal.tsx            (NEW)
  components/CommandPalette.tsx           (NEW)
  components/QueryTab.tsx                 (MODIFY: hide Cancel for mongodb)
  components/ResultsPanel.tsx             (MODIFY: export tooltips)
  components/ConnectionModal.tsx          (MODIFY: Test aria-label)
  components/ObjectTree.tsx               (MODIFY: tokenized error color)
package.json                              (MODIFY: +cmdk)
```

**Unit boundaries:** Tasks 1–4 = U1. Tasks 5–8 = U2 (depends on U1's hooks, channel, and store conventions). Task 9 = controller verification + packaging.

---

## Task 1: Navigation hardening + application menu (main process)

The renderer displays DB-sourced content. Today nothing stops `window.open(...)` from spawning a BrowserWindow or an injected link from navigating the app away. Also: the **default** application menu binds ⌘W to window-close at the *menu* level, so the renderer never sees the keydown — Task 7's "⌘W closes tab" needs the menu rebound here first.

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create the menu module**

Create `src/main/menu.ts`:

```ts
import { Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Replace the default application menu so CmdOrCtrl+W reaches the renderer
 * (it closes the active query tab there); window close moves to
 * Shift+CmdOrCtrl+W. Standard roles are kept — without editMenu, ⌘C/⌘V/⌘X
 * keyboard editing stops working on macOS.
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    {
      label: 'File',
      submenu: [
        { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' },
        ...(isMac ? [] : ([{ role: 'quit' }] as MenuItemConstructorOptions[]))
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

- [ ] **Step 2: Harden the window + install the menu + theme-aware background**

Replace the full contents of `src/main/index.ts` with:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { openDb } from './persistence/db'
import { getSettings } from './persistence/settings'

/**
 * Match the window background to the saved theme so launch doesn't flash
 * the wrong color. Guarded: a broken better-sqlite3 must never stop the
 * app from launching (openDb is deliberately lazy everywhere else).
 */
function windowBackground(): string {
  try {
    return getSettings(openDb()).theme === 'light' ? '#f7f8fa' : '#0f1117'
  } catch {
    return '#0f1117'
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: windowBackground(),
    minWidth: 940,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  // The renderer shows DB-sourced content; it must never become a browser.
  // Deny popups outright and block navigation away from the app itself
  // (dev-server full reloads emit will-navigate to the same dev URL — allowed).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  installAppMenu()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

Check the import names against `src/main/persistence/settings.ts` / `src/main/persistence/db.ts` before assuming — `getSettings(db)` and `openDb()` are the existing exports used by `src/main/ipc.ts:89`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (61 tests — no behavior under unit test changed).

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "feat: deny popups/navigation, custom app menu freeing cmd-w, theme-aware window bg"
```

---

## Task 2: `dialog.pickDirectory` IPC channel (#20)

Settings (Task 5) needs a native directory picker for data-dir relocation. The sandboxed renderer can't show one — route via main, same pattern as `clipboard.copy`.

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`

- [ ] **Step 1: Add the channel to the contract**

In `src/shared/ipc.ts`, after the `'clipboard.copy'` line inside `IpcChannels`, add:

```ts
  'dialog.pickDirectory': { req: void; res: string | null }
```

(`null` = user cancelled.)

- [ ] **Step 2: Add to the API surface**

In `src/shared/api.ts`, after the `clipboard` block inside `DbClientApi`, add:

```ts
  dialog: {
    pickDirectory(): Promise<IpcResult<'dialog.pickDirectory'>>
  }
```

- [ ] **Step 3: Expose in preload**

In `src/preload/index.ts`, after the `clipboard` block in the `api` object, add:

```ts
  dialog: {
    pickDirectory: () => invoke('dialog.pickDirectory', undefined)
  }
```

- [ ] **Step 4: Handle in main**

In `src/main/ipc.ts`:

Change the electron import to:

```ts
import { ipcMain, clipboard, dialog, BrowserWindow } from 'electron'
```

After the `clipboard.copy` handler at the end of `registerIpcHandlers`, add:

```ts
  handle('dialog.pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return ok(r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0])
  })
```

- [ ] **Step 5: Check the channel-contract test**

`src/shared/ipc.test.ts` exercises the channel map. Read it; if it enumerates channel names or counts, add `dialog.pickDirectory`. If it's purely type-level, no change.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts src/shared/ipc.test.ts
git commit -m "feat: dialog.pickDirectory IPC channel for native directory picker"
```

---

## Task 3: App icon

`electron-builder.yml` already declares `buildResources: build`, but no `build/` dir exists — packaged apps ship the default Electron icon. A single `build/icon.png` ≥512px is auto-converted to `.icns`/`.ico` by electron-builder. Commit the SVG source too.

**Files:**
- Create: `build/icon.svg`, `build/icon.png`

- [ ] **Step 1: Create the vector source**

Create `build/icon.svg` (macOS-style rounded square with margin; indigo gradient; white database cylinder):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <g fill="none" stroke="#ffffff" stroke-width="56" stroke-linecap="round">
    <ellipse cx="512" cy="360" rx="220" ry="92"/>
    <path d="M292 360v304c0 51 98 92 220 92s220-41 220-92V360"/>
    <path d="M292 462c0 51 98 92 220 92s220-41 220-92"/>
    <path d="M292 564c0 51 98 92 220 92s220-41 220-92"/>
  </g>
</svg>
```

- [ ] **Step 2: Rasterize to 1024px PNG**

macOS has no ImageMagick by default, but QuickLook renders SVG:

```bash
qlmanage -t -s 1024 -o build build/icon.svg
mv build/icon.svg.png build/icon.png
sips -g pixelWidth -g pixelHeight build/icon.png
```

Expected: `pixelWidth: 1024` / `pixelHeight: 1024`. If `qlmanage` produced nothing (no QuickLook SVG generator), report **BLOCKED** with the command output — do not substitute a low-res icon.

- [ ] **Step 3: Verify electron-builder picks it up**

No `electron-builder.yml` change needed — `icon.png` inside `buildResources` is the documented auto-detect location. Confirm the file sits at exactly `build/icon.png`.

- [ ] **Step 4: Commit**

```bash
git add build/icon.svg build/icon.png
git commit -m "feat: app icon (svg source + 1024px raster for electron-builder)"
```

---

## Task 4: Light theme

Theme system: tokenize the hardcoded colors in `styles.css`, add a `:root[data-theme='light']` override block, define a Monaco `daylight` theme, and apply the saved setting via a renderer effect. The setting already persists (`settings.get/set`, `AppSettings.theme: 'midnight' | 'light'`).

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/lib/monaco.ts`
- Modify: `src/renderer/src/components/MonacoEditor.tsx`
- Modify: `src/renderer/src/lib/hooks.ts`
- Create: `src/renderer/src/lib/theme.ts`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/ObjectTree.tsx`

- [ ] **Step 1: Extend the token block in `styles.css`**

Replace the existing `:root { … }` block (lines 1–16) with:

```css
/* ── Midnight theme tokens (default) ── */
:root {
  color-scheme: dark;
  --bg: #0f1117;
  --bg-2: #13161f;
  --bg-3: #1b1f2c;
  --border: #232838;
  --text: #e3e7f0;
  --text-2: #8b93a7;
  --accent: #6366f1;
  --accent-hover: #7577f3;
  --danger: #ef4444;
  --danger-hover: #f46868;
  --danger-text: #fca5a5;
  --ok: #22c55e;
  --warn: #fbbf24;
  --warn-border: #fbbf2444;
  --scroll-thumb: #2a2f40;
  --scroll-thumb-hover: #343a50;
  --btn-hover-bg: #242840;
  --btn-hover-border: #343a50;
  --row-odd: #13161f66;
  --hover-overlay: rgba(255, 255, 255, 0.1);
  --swatch-ring: #ffffff;
  --modal-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  --json-key: #93c5fd;
  --json-string: #34d399;
  --json-number: #fbbf24;
  --json-bool: #c4b5fd;
  --obj-table: #a5b4fc;
  --obj-view: #67e8f9;
  --obj-coll: #86efac;
  --radius: 6px;
  --topbar-h: 44px;
}

/* ── Light theme overrides ── */
:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f7f8fa;
  --bg-2: #ffffff;
  --bg-3: #eef0f4;
  --border: #d9dde6;
  --text: #1b2230;
  --text-2: #5b6577;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --danger: #dc2626;
  --danger-hover: #b91c1c;
  --danger-text: #b91c1c;
  --ok: #16a34a;
  --warn: #b45309;
  --warn-border: #b4530944;
  --scroll-thumb: #c6cbd8;
  --scroll-thumb-hover: #aeb5c6;
  --btn-hover-bg: #e4e7ee;
  --btn-hover-border: #c6cbd8;
  --row-odd: #eef0f466;
  --hover-overlay: rgba(0, 0, 0, 0.08);
  --swatch-ring: #1b2230;
  --modal-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
  --json-key: #1d4ed8;
  --json-string: #047857;
  --json-number: #b45309;
  --json-bool: #7c3aed;
  --obj-table: #4338ca;
  --obj-view: #0e7490;
  --obj-coll: #15803d;
}
```

(`--radius`/`--topbar-h` are layout, not repeated in the light block. `color-scheme` makes native `<select>`/checkbox/scrollbar chrome follow the theme.)

- [ ] **Step 2: Point the hardcoded colors at the new tokens**

In `styles.css`, make exactly these replacements (values shown are the current ones to find):

| Selector | Property | Old | New |
|---|---|---|---|
| `::-webkit-scrollbar-thumb` | `background` | `#2a2f40` | `var(--scroll-thumb)` |
| `::-webkit-scrollbar-thumb:hover` | `background` | `#343a50` | `var(--scroll-thumb-hover)` |
| `.btn:hover:not(:disabled)` | `background` | `#242840` | `var(--btn-hover-bg)` |
| `.btn:hover:not(:disabled)` | `border-color` | `#343a50` | `var(--btn-hover-border)` |
| `.welcome .error` | `color` | `#fca5a5` | `var(--danger-text)` |
| `.modal` | `box-shadow` | `0 20px 60px rgba(0,0,0,0.6)` | `var(--modal-shadow)` |
| `.swatch.selected` | `border-color` | `#fff` | `var(--swatch-ring)` |
| `.status.err` | `color` | `#fca5a5` | `var(--danger-text)` |
| `.obj-icon.table` | `color` | `#a5b4fc` | `var(--obj-table)` |
| `.obj-icon.view` | `color` | `#67e8f9` | `var(--obj-view)` |
| `.obj-icon.collection` | `color` | `#86efac` | `var(--obj-coll)` |
| `.tree-error` | `color` | `#fca5a5` | `var(--danger-text)` |
| `.tab-close:hover` | `background` | `rgba(255,255,255,0.1)` | `var(--hover-overlay)` |
| `.qt-status.err` | `color` | `#f87171` | `var(--danger-text)` |
| `.qt-error` | `color` | `#f87171` | `var(--danger-text)` |
| `.chip-warn` | `color` | `#fbbf24` | `var(--warn)` |
| `.chip-warn` | `border` | `1px solid #fbbf2444` | `1px solid var(--warn-border)` |
| `.grid-row.odd` | `background` | `#13161f66` | `var(--row-odd)` |
| `.json-key` | `color` | `#93c5fd` | `var(--json-key)` |
| `.json-string` | `color` | `#34d399` | `var(--json-string)` |
| `.json-number` | `color` | `#fbbf24` | `var(--json-number)` |
| `.json-bool` | `color` | `#c4b5fd` | `var(--json-bool)` |
| `.h-dot.ok` | `background` | `#34d399` | `var(--ok)` |
| `.h-dot.fail` | `background` | `#f87171` | `var(--danger)` |

Leave alone: the `.conn-select` arrow SVG fill (`#8b93a7` reads on both themes), translucent `rgba(239,68,68,…)` error backgrounds, the accent-based focus rings, and `.obj-icon.*` translucent backgrounds.

In `src/renderer/src/components/ObjectTree.tsx`, the error paragraph uses an inline hex (`style={{ color: '#fca5a5' }}`). Change it to:

```tsx
        <p style={{ color: 'var(--danger-text)' }} role="alert">
```

- [ ] **Step 3: Monaco `daylight` theme + theme map + explicit default**

In `src/renderer/src/lib/monaco.ts`, after the existing `defineTheme('midnight', …)` call, add:

```ts
monaco.editor.defineTheme('daylight', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '4f46e5' },
    { token: 'string', foreground: '047857' },
    { token: 'number', foreground: 'b45309' },
    { token: 'comment', foreground: '9aa3b5' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1b2230',
    'editor.lineHighlightBackground': '#f1f3f780',
    'editorLineNumber.foreground': '#c0c7d4',
    'editorCursor.foreground': '#4f46e5',
    'editor.selectionBackground': '#6366f133'
  }
})

/** Monaco theme name for each app theme. */
export const MONACO_THEME = { midnight: 'midnight', light: 'daylight' } as const

// Default until settings load; applyTheme() re-applies the saved choice.
monaco.editor.setTheme('midnight')
```

- [ ] **Step 4: Drop the per-editor theme option**

In `src/renderer/src/components/MonacoEditor.tsx`, **delete** the `theme: 'midnight',` line from the `monaco.editor.create` options and add this comment in its place:

```ts
      // No theme here: monaco themes are global, and passing one at create()
      // would reset the app-wide choice every time a tab mounts.
```

- [ ] **Step 5: Settings hooks**

In `src/renderer/src/lib/hooks.ts`, append:

```ts
// ── Settings ─────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get().then(unwrap),
    retry: false,
  })
}

export function useSetSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      window.api.settings.set(key, value).then(unwrap),
    // settings.set returns the full updated AppSettings — write it straight into the cache.
    onSuccess: (settings) => qc.setQueryData(['settings'], settings),
  })
}

export function useDataDir() {
  return useQuery({
    queryKey: ['dataDir'],
    queryFn: () => window.api.settings.getDataDir().then(unwrap),
    retry: false,
  })
}

export function useSetDataDir() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dir: string) => window.api.settings.setDataDir(dir).then(unwrap),
    // Relocation swaps the underlying database file — every cached read is stale.
    onSuccess: () => void qc.invalidateQueries(),
  })
}
```

- [ ] **Step 6: Theme helpers**

Create `src/renderer/src/lib/theme.ts`:

```ts
import type { AppSettings } from '@shared/domain'
import { monaco, MONACO_THEME } from './monaco'

const THEME_HINT_KEY = 'theme-hint'

/**
 * Settings arrive async over IPC; this localStorage hint lets the very first
 * paint match the saved theme. The sqlite setting stays the source of truth —
 * applyTheme() rewrites the hint on every change.
 */
export function themeHint(): AppSettings['theme'] {
  return localStorage.getItem(THEME_HINT_KEY) === 'light' ? 'light' : 'midnight'
}

export function applyTheme(theme: AppSettings['theme']): void {
  document.documentElement.dataset.theme = theme
  monaco.editor.setTheme(MONACO_THEME[theme])
  localStorage.setItem(THEME_HINT_KEY, theme)
}
```

- [ ] **Step 7: Pre-React hint in `main.tsx`**

In `src/renderer/src/main.tsx`, after the imports and before `ReactDOM.createRoot(...)`, add:

```ts
import { themeHint } from './lib/theme'

// Set before first paint so a light-theme user doesn't get a dark flash.
document.documentElement.dataset.theme = themeHint()
```

(Keep the import grouped with the others; the statement goes above the render call.)

- [ ] **Step 8: Apply the saved theme in `App.tsx`**

In `src/renderer/src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { useSettings } from './lib/hooks'
import { applyTheme } from './lib/theme'
```

Inside `AppShell`, before the `return`:

```tsx
  const { data: settings } = useSettings()
  useEffect(() => {
    if (settings) applyTheme(settings.theme)
  }, [settings])
```

- [ ] **Step 9: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green. Then in the running dev app (controller will do the visual pass): DevTools console →
`document.documentElement.dataset.theme = 'light'` should flip every surface (no dark remnants except Monaco, which needs the setting → covered in Task 5's live check).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/lib/monaco.ts src/renderer/src/lib/theme.ts src/renderer/src/lib/hooks.ts src/renderer/src/main.tsx src/renderer/src/App.tsx src/renderer/src/components/MonacoEditor.tsx src/renderer/src/components/ObjectTree.tsx
git commit -m "feat: light theme (token overrides, monaco daylight, applyTheme effect)"
```

---

## Task 5: Settings modal + TopBar gear

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Create: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/components/TopBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Overlay state in the store**

In `src/renderer/src/state/store.ts`, add to the `AppState` interface (after `connectionModal`):

```ts
  settingsOpen: boolean
  paletteOpen: boolean
```

and after `closeModal`:

```ts
  openSettings: () => void
  closeSettings: () => void
  setPaletteOpen: (open: boolean) => void
```

In the `create<AppState>` initializer, add the state (after `connectionModal: null,`):

```ts
  settingsOpen: false,
  paletteOpen: false,
```

and the actions (after `closeModal`):

```ts
  openSettings: () => set({ settingsOpen: true, paletteOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
```

(`openSettings` closes the palette: "Open settings" is itself a palette command.)

- [ ] **Step 2: Create `SettingsModal.tsx`**

Create `src/renderer/src/components/SettingsModal.tsx`:

```tsx
import { useAppStore } from '../state/store'
import { useSettings, useSetSetting, useDataDir, useSetDataDir } from '../lib/hooks'
import { unwrap } from '../lib/result'

export default function SettingsModal(): JSX.Element {
  const closeSettings = useAppStore((s) => s.closeSettings)

  const { data: settings } = useSettings()
  const { data: dataDir } = useDataDir()
  const setSetting = useSetSetting()
  const setDataDir = useSetDataDir()

  const theme = settings?.theme ?? 'midnight'

  async function changeDataDir(): Promise<void> {
    const dir = await window.api.dialog.pickDirectory().then(unwrap)
    if (dir) setDataDir.mutate(dir)
  }

  return (
    <div className="modal-overlay" onClick={closeSettings}>
      <div
        className="modal"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Settings</h2>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label>Theme</label>
              <div className="seg" role="radiogroup" aria-label="Theme">
                <button
                  className={`seg-btn${theme === 'midnight' ? ' active' : ''}`}
                  onClick={() => setSetting.mutate({ key: 'theme', value: 'midnight' })}
                >
                  Midnight
                </button>
                <button
                  className={`seg-btn${theme === 'light' ? ' active' : ''}`}
                  onClick={() => setSetting.mutate({ key: 'theme', value: 'light' })}
                >
                  Light
                </button>
              </div>
            </div>

            <div className="form-row">
              <label>Data directory</label>
              <div className="datadir-row">
                <code className="datadir-path" title={dataDir ?? ''}>
                  {dataDir ?? '…'}
                </code>
                <button
                  className="btn"
                  onClick={() => void changeDataDir()}
                  disabled={setDataDir.isPending}
                >
                  {setDataDir.isPending ? 'Moving…' : 'Change…'}
                </button>
              </div>
              <p className="form-hint">
                Connections, history and settings live here. Changing it copies your data
                to the new folder.
              </p>
              {setDataDir.isError && (
                <div className="status err" role="alert">
                  {setDataDir.error instanceof Error
                    ? setDataDir.error.message
                    : String(setDataDir.error)}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn primary" onClick={closeSettings}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
```

("copies your data" is accurate: `relocateDataDir` copies the sqlite file before repointing.)

- [ ] **Step 3: Settings CSS**

Append to `src/renderer/src/styles.css`:

```css
/* ── Settings modal ── */
.datadir-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.datadir-path {
  flex: 1;
  min-width: 0;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 5px 9px;
  font-family: ui-monospace, 'SF Mono', 'Fira Mono', monospace;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.form-hint {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.5;
}
```

- [ ] **Step 4: Gear in `TopBar.tsx`**

In `src/renderer/src/components/TopBar.tsx`, add the selector inside the component:

```tsx
  const openSettings = useAppStore((s) => s.openSettings)
```

and after the `+ New connection` button (last element in the header):

```tsx
      <button
        className="btn ghost"
        onClick={openSettings}
        aria-label="Settings"
        title="Settings (⌘,)"
      >
        ⚙
      </button>
```

- [ ] **Step 5: Mount in `App.tsx`**

In `AppShell`, add a selector:

```tsx
  const settingsOpen = useAppStore((s) => s.settingsOpen)
```

and next to the existing `{connectionModal && <ConnectionModal />}` line:

```tsx
      {settingsOpen && <SettingsModal />}
```

with the import `import SettingsModal from './components/SettingsModal'`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/components/SettingsModal.tsx src/renderer/src/components/TopBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat: settings modal (theme toggle, data-dir relocation) + topbar gear"
```

---

## Task 6: ⌘K command palette (cmdk)

**Files:**
- Modify: `package.json` (via `npm install cmdk`)
- Create: `src/renderer/src/components/CommandPalette.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Install cmdk**

```bash
npm install cmdk
```

Expected: `cmdk` (^1.x) appears in `dependencies`. (`postinstall` runs `electron-builder install-app-deps` — normal, takes a few seconds.)

- [ ] **Step 2: Create `CommandPalette.tsx`**

Create `src/renderer/src/components/CommandPalette.tsx`:

```tsx
import { Command } from 'cmdk'
import { useAppStore } from '../state/store'
import { useConnections, useObjects, useSettings, useSetSetting } from '../lib/hooks'
import { defaultTableQuery } from '../lib/tabquery'

/** Rendered only while open (parent gates on store.paletteOpen). */
export default function CommandPalette(): JSX.Element {
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const openSettings = useAppStore((s) => s.openSettings)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)

  const { data: connections = [] } = useConnections()
  const { data: objects = [] } = useObjects(activeConnectionId)
  const { data: settings } = useSettings()
  const setSetting = useSetSetting()

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  function close(): void {
    setPaletteOpen(false)
  }

  return (
    <div className="palette-overlay" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <Command label="Command palette">
          <Command.Input autoFocus placeholder="Type a command or search…" />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>

            <Command.Group heading="Actions">
              {activeConnectionId && (
                <Command.Item
                  value="action new query tab"
                  onSelect={() => {
                    openQueryTab({ connectionId: activeConnectionId })
                    close()
                  }}
                >
                  New query tab
                  <span className="kbd">⌘T</span>
                </Command.Item>
              )}
              <Command.Item
                value="action toggle theme"
                onSelect={() => {
                  setSetting.mutate({
                    key: 'theme',
                    value: settings?.theme === 'light' ? 'midnight' : 'light',
                  })
                  close()
                }}
              >
                Toggle theme
              </Command.Item>
              <Command.Item value="action open settings" onSelect={openSettings}>
                Open settings
                <span className="kbd">⌘,</span>
              </Command.Item>
            </Command.Group>

            {connections.length > 0 && (
              <Command.Group heading="Connections">
                {connections.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`connection ${c.name} ${c.type}`}
                    onSelect={() => {
                      setActiveConnection(c.id)
                      close()
                    }}
                  >
                    <span
                      className="conn-dot"
                      style={{ background: c.color, width: 8, height: 8 }}
                      aria-hidden="true"
                    />
                    {c.name}
                    <span className="palette-meta">{c.type}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {activeConn && objects.length > 0 && (
              <Command.Group heading={`Objects — ${activeConn.name}`}>
                {objects.map((o) => (
                  <Command.Item
                    key={`${o.schema ?? ''}:${o.name}`}
                    value={`object ${o.schema ?? ''} ${o.name}`}
                    onSelect={() => {
                      openQueryTab({
                        connectionId: activeConn.id,
                        title: o.name,
                        text: defaultTableQuery(activeConn.type, {
                          schema: o.schema,
                          name: o.name,
                        }),
                        runOnOpen: true,
                      })
                      close()
                    }}
                  >
                    <span className={`obj-icon ${o.kind}`} aria-hidden="true">
                      {o.kind === 'table' ? 'T' : o.kind === 'view' ? 'V' : 'C'}
                    </span>
                    {o.name}
                    {o.schema && <span className="palette-meta">{o.schema}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
```

Notes for the implementer:
- "Open settings" doesn't call `close()` — `openSettings` in the store already sets `paletteOpen: false`.
- `useObjects` reuses the same TanStack cache the tree filled; no new IPC when the tree already loaded.
- Explicit `value` props keep filtering deterministic (items contain mixed text + spans).

- [ ] **Step 3: Palette CSS**

Append to `src/renderer/src/styles.css`:

```css
/* ── Command palette ── */
.palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 96px;
}

.palette {
  width: 560px;
  max-width: calc(100vw - 48px);
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--modal-shadow);
  overflow: hidden;
}

.palette [cmdk-input] {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 14px 16px;
  font-size: 14px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}

.palette [cmdk-list] {
  max-height: 380px;
  overflow: auto;
  padding: 6px;
  scroll-padding-block: 6px;
}

.palette [cmdk-group-heading] {
  padding: 8px 10px 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-2);
}

.palette [cmdk-item] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text);
}

.palette [cmdk-item][data-selected='true'] {
  background: var(--accent);
  color: #fff;
}

.palette [cmdk-item][data-selected='true'] .palette-meta,
.palette [cmdk-item][data-selected='true'] .kbd {
  color: rgba(255, 255, 255, 0.75);
}

.palette [cmdk-empty] {
  padding: 16px;
  text-align: center;
  color: var(--text-2);
  font-size: 13px;
}

.palette-meta,
.kbd {
  margin-left: auto;
  color: var(--text-2);
  font-size: 11px;
}

.kbd {
  font-family: ui-monospace, 'SF Mono', 'Fira Mono', monospace;
}
```

- [ ] **Step 4: Mount in `App.tsx`**

In `AppShell`, add:

```tsx
  const paletteOpen = useAppStore((s) => s.paletteOpen)
```

and next to the SettingsModal mount:

```tsx
      {paletteOpen && <CommandPalette />}
```

with the import `import CommandPalette from './components/CommandPalette'`.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/CommandPalette.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat: cmdk command palette (connections, objects, actions)"
```

---

## Task 7: Keyboard shortcuts

⌘K palette, ⌘T new tab, ⌘W close tab, ⌘, settings, Escape closes overlays. Pure mapping is unit-tested; the DOM wiring is a capture-phase hook so our chords beat Monaco's own keybindings (Monaco has a ⌘K chord) while the editor is focused. Task 1 already freed ⌘W from the menu.

**Files:**
- Create: `src/renderer/src/lib/shortcuts.ts`
- Create: `src/renderer/src/lib/shortcuts.test.ts`
- Create: `src/renderer/src/lib/use-global-shortcuts.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/shortcuts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveShortcut } from './shortcuts'

const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }

describe('resolveShortcut', () => {
  it('maps mod+k to palette for both meta and ctrl', () => {
    expect(resolveShortcut({ ...base, key: 'k', metaKey: true })).toBe('palette')
    expect(resolveShortcut({ ...base, key: 'k', ctrlKey: true })).toBe('palette')
  })

  it('maps mod+t, mod+w and mod+, to tab/settings actions', () => {
    expect(resolveShortcut({ ...base, key: 't', metaKey: true })).toBe('new-tab')
    expect(resolveShortcut({ ...base, key: 'w', metaKey: true })).toBe('close-tab')
    expect(resolveShortcut({ ...base, key: ',', ctrlKey: true })).toBe('settings')
  })

  it('is case-insensitive on the key', () => {
    expect(resolveShortcut({ ...base, key: 'W', metaKey: true })).toBe('close-tab')
  })

  it('requires a modifier', () => {
    expect(resolveShortcut({ ...base, key: 'k' })).toBeNull()
  })

  it('rejects alt and shift chords (Shift+mod+W stays the menu window-close)', () => {
    expect(resolveShortcut({ ...base, key: 'k', metaKey: true, altKey: true })).toBeNull()
    expect(resolveShortcut({ ...base, key: 'w', metaKey: true, shiftKey: true })).toBeNull()
  })

  it('ignores unmapped keys', () => {
    expect(resolveShortcut({ ...base, key: 'p', metaKey: true })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/renderer/src/lib/shortcuts.test.ts`
Expected: FAIL — cannot resolve `./shortcuts`.

- [ ] **Step 3: Implement the mapping**

Create `src/renderer/src/lib/shortcuts.ts`:

```ts
export type ShortcutAction = 'palette' | 'new-tab' | 'close-tab' | 'settings'

export interface KeyChord {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Map a keydown to an app action. Meta on macOS, Ctrl elsewhere — both accepted.
 * Shift chords are rejected on purpose: Shift+Cmd+W remains the menu's
 * window-close accelerator (src/main/menu.ts).
 */
export function resolveShortcut(e: KeyChord): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.altKey || e.shiftKey) return null
  switch (e.key.toLowerCase()) {
    case 'k':
      return 'palette'
    case 't':
      return 'new-tab'
    case 'w':
      return 'close-tab'
    case ',':
      return 'settings'
    default:
      return null
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/lib/shortcuts.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: The DOM hook**

Create `src/renderer/src/lib/use-global-shortcuts.ts`:

```ts
import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { resolveShortcut } from './shortcuts'

/**
 * App-wide keyboard shortcuts. Registered on the capture phase so our chords
 * win over Monaco's own keybindings (it owns a ⌘K chord) while an editor is
 * focused. ⌘W with no tabs is deliberately swallowed — accidental window
 * close from muscle memory is worse; Shift+⌘W still closes the window.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const s = useAppStore.getState()

      if (e.key === 'Escape') {
        // Only intercept when an overlay is up — Monaco needs Escape otherwise.
        if (s.paletteOpen) {
          e.preventDefault()
          s.setPaletteOpen(false)
        } else if (s.settingsOpen) {
          e.preventDefault()
          s.closeSettings()
        }
        return
      }

      const action = resolveShortcut(e)
      if (!action) return

      // While an overlay is up, only its own toggle applies — ⌘W must not
      // close a tab hidden behind the settings modal.
      if (s.settingsOpen && action !== 'settings') return
      if (s.paletteOpen && action !== 'palette') return

      e.preventDefault()
      e.stopPropagation()
      switch (action) {
        case 'palette':
          s.setPaletteOpen(!s.paletteOpen)
          break
        case 'settings':
          if (s.settingsOpen) s.closeSettings()
          else s.openSettings()
          break
        case 'new-tab':
          if (s.activeConnectionId) s.openQueryTab({ connectionId: s.activeConnectionId })
          break
        case 'close-tab':
          if (s.activeTabId) s.closeTab(s.activeTabId)
          break
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
```

- [ ] **Step 6: Wire into `App.tsx`**

In `AppShell`, first line of the body:

```tsx
  useGlobalShortcuts()
```

with the import `import { useGlobalShortcuts } from './lib/use-global-shortcuts'`.

- [ ] **Step 7: Verify the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green, 67 unit tests (61 + 6).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/shortcuts.ts src/renderer/src/lib/shortcuts.test.ts src/renderer/src/lib/use-global-shortcuts.ts src/renderer/src/App.tsx
git commit -m "feat: global keyboard shortcuts (cmd-k/t/w/comma, escape closes overlays)"
```

---

## Task 8: 4b carry-ins

Three small reviewer follow-ups from Plan 4b.

**Files:**
- Modify: `src/renderer/src/components/QueryTab.tsx`
- Modify: `src/renderer/src/components/ResultsPanel.tsx`
- Modify: `src/renderer/src/components/ConnectionModal.tsx`

- [ ] **Step 1: Hide Cancel for MongoDB connections**

In `src/renderer/src/components/QueryTab.tsx`, the Cancel button currently renders when `tab.running && tab.queryId`. Change the gate to:

```tsx
        {tab.running && tab.queryId && connection?.type !== 'mongodb' && (
```

and add this comment directly above the line:

```tsx
        {/* Mongo ops can't be killed mid-flight (driver cancel is a no-op; they
            bound themselves via maxTimeMS) — a Cancel that silently does nothing
            is worse than no button. */}
```

- [ ] **Step 2: Export tooltips**

In `src/renderer/src/components/ResultsPanel.tsx`, add a `title` to both export buttons:

```tsx
          <button
            className="btn"
            title="Exports all rows (ignores the filter)"
            onClick={() => download('result.csv', toCsv(result.columns, result.rows), 'text/csv')}
          >
            CSV
          </button>
          <button
            className="btn"
            title="Exports all rows (ignores the filter)"
            onClick={() => download('result.json', toJsonText(result), 'application/json')}
          >
            JSON
          </button>
```

- [ ] **Step 3: Test button aria-label**

In `src/renderer/src/components/ConnectionModal.tsx`, the Test button (renders `{testStatus.kind === 'pending' ? 'Testing…' : 'Test'}` around line 339) gets:

```tsx
            aria-label="Test connection"
```

added to its props.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/QueryTab.tsx src/renderer/src/components/ResultsPanel.tsx src/renderer/src/components/ConnectionModal.tsx
git commit -m "fix: hide no-op mongo cancel, export tooltips, test button aria-label"
```

---

## Task 9: Verification & packaging (controller-driven — not a subagent task)

- [ ] Full gates: `npm run typecheck && npm run lint && npm test` (67 unit) and `npm run test:integration` (12/12; Docker must be up).
- [ ] Restart the dev app (main-process changes don't hot-reload). Live checklist:
  - `window.open('https://example.com')` in DevTools console → returns `null`, no window appears. `location.href = 'https://example.com'` → nothing happens. Vite full-reload (edit `index.html` comment) still works.
  - Settings gear → modal opens; theme toggles Midnight ⇄ Light live: shell, grid, history, scrollbars, Monaco, native select chrome all flip; restart app → light persists with no dark flash; window chrome bg matches.
  - Data dir: Change… opens native picker; pick a fresh folder → path updates, connections survive (file copied); Cancel → no-op.
  - ⌘K → palette; type to filter connections/objects/actions; Enter opens table tab auto-running; ⌘T opens tab; ⌘W closes tab (window stays); Shift+⌘W closes window; ⌘, opens settings; Escape closes overlays; ⌘K while Monaco focused still opens palette; ⌘C/⌘V still work in editor + inputs.
  - Mongo connection: Run a slow-ish find → no Cancel button; Postgres long query → Cancel still shows and works.
- [ ] Packaging: `npm run package:mac` → dmg in `dist/`; mount and launch: custom icon in Finder/Dock, queries work against the demo postgres (native module + Monaco workers intact in the asar build), theme toggle works packaged.
- [ ] Update `electron-builder` output `dist/` is git-ignored (it is — verify `git status` stays clean).
- [ ] Final code review (subagent) over the full branch diff, then merge ceremony per superpowers:finishing-a-development-branch.

---

## Self-review

- **Spec coverage:** roadmap 4c scope = ⌘K palette (Task 6) ✓, Settings view with theme toggle + data-dir UI (Task 5) ✓, light theme (Task 4) ✓, keyboard shortcuts (Task 7) ✓, app icons (Task 3) ✓, packaging re-verify (Task 9) ✓, navigation hardening (Task 1) ✓, 4b carry-ins (Task 8) ✓, dialog channel prerequisite (Task 2) ✓. EJSON relaxed-mode deferral documented in the header.
- **Placeholder scan:** none — every step carries complete code or exact commands.
- **Type consistency:** `MONACO_THEME` defined in Task 4 Step 3, consumed in Task 4 Step 6; store actions `openSettings/closeSettings/setPaletteOpen` defined Task 5 Step 1, consumed Tasks 5–7; `resolveShortcut`/`KeyChord` defined Task 7 Step 3, consumed Step 5; `dialog.pickDirectory` defined Task 2, consumed Task 5 Step 2. `unwrap` returns `T` from `Result<T> = {ok:true; data:T} | {ok:false; error:string}` — matches existing `src/renderer/src/lib/result.ts`.
- **Ordering note:** Task 7's ⌘W only works because Task 1 rebound the menu accelerator — both tasks call this out.
