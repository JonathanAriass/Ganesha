# Foundation & IPC Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable Electron + React + TypeScript app where the React UI calls the Node "backend" over a narrow, typed IPC bridge — with unit tests and a cross-platform packaging baseline all green.

**Architecture:** Electron two-process model built with `electron-vite`. The **main** process is the privileged "backend"; the **preload** exposes a narrow, typed `window.api` via `contextBridge` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`); the **renderer** is pure React UI that only calls `window.api`. A shared `Result<T>` envelope and IPC contract types live in `src/shared` and are imported by both sides so the boundary is type-checked end to end.

**Tech Stack:** Electron, electron-vite (Vite 5), React 18 + TypeScript, Vitest (unit tests), electron-builder (packaging). All DB/UI libraries arrive in later plans — this plan is the skeleton only.

**This is Plan 1 of 4** (Foundation → Persistence & Secrets → Database Drivers → UI). It must produce a launchable app and a green `npm test` before Plan 2 begins.

---

## File Structure (created by this plan)

```
package.json                      deps + scripts
electron.vite.config.ts           main/preload/renderer build config
tsconfig.json                     references the two configs below
tsconfig.node.json                main + preload + shared (Node env)
tsconfig.web.json                 renderer (DOM env)
vitest.config.ts                  unit-test runner (node env)
electron-builder.yml              cross-platform packaging targets
src/
  shared/
    result.ts                     Result<T> envelope + ok()/err()
    result.test.ts                unit tests for the envelope
    ipc.ts                        IPC channel names + request/response types
    api.ts                        DbClientApi interface (shape of window.api)
  main/
    index.ts                      app bootstrap, BrowserWindow, security
    ipc.ts                        registerIpcHandlers() — ping handler
  preload/
    index.ts                      contextBridge → window.api
    index.d.ts                    global Window.api typing
  renderer/
    index.html                    renderer entry HTML
    src/
      main.tsx                    React mount
      App.tsx                     placeholder shell that proves IPC works
      env.d.ts                    vite client + window.api reference
```

Boundary rule enforced here: **`src/renderer` never imports from `src/main`**. The only cross-boundary surface is `src/shared` (types) and `window.api` (runtime). Keep it that way in every later plan.

---

## Task 1: package.json + install dependencies

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "db-client",
  "version": "0.0.1",
  "description": "Modern, fast, cross-platform database client",
  "author": "JonathanAriass",
  "license": "MIT",
  "main": "./out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "test": "vitest run",
    "test:watch": "vitest",
    "package:mac": "npm run build && electron-builder --mac",
    "package:win": "npm run build && electron-builder --win",
    "package:linux": "npm run build && electron-builder --linux"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.3.0",
    "electron-builder": "^24.13.3",
    "electron-vite": "^2.3.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

> Versions above are a known-compatible set; bump later if you like, but keep `electron-vite` 2.x paired with `vite` 5.x.

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes without peer-dependency errors; `node_modules/` and `package-lock.json` appear.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: scaffold package.json and install foundation deps"
```

---

## Task 2: TypeScript, electron-vite, and Vitest configuration

**Files:**
- Create: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.ts`

- [ ] **Step 1: Create `tsconfig.json`** (solution file referencing the two real configs)

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

- [ ] **Step 2: Create `tsconfig.node.json`** (main + preload + shared, Node env)

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/main", "src/preload", "src/shared", "electron.vite.config.ts"]
}
```

- [ ] **Step 3: Create `tsconfig.web.json`** (renderer, DOM env)

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/renderer/src", "src/shared"]
}
```

- [ ] **Step 4: Create `electron.vite.config.ts`**

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    plugins: [react()]
  }
})
```

- [ ] **Step 5: Create `vitest.config.ts`** (runs pure unit tests in a Node environment)

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist']
  }
})
```

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsconfig.node.json tsconfig.web.json electron.vite.config.ts vitest.config.ts
git commit -m "chore: add TypeScript, electron-vite, and Vitest configuration"
```

---

## Task 3: Shared `Result<T>` envelope (TDD)

Every IPC call returns a `Result<T>` — success carries data, failure carries a message — so the renderer never deals with thrown errors across the boundary. This is the most-reused primitive in the codebase, so we build it test-first.

**Files:**
- Create: `src/shared/result.ts`
- Test: `src/shared/result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/result.test.ts
import { describe, it, expect } from 'vitest'
import { ok, err } from './result'

describe('Result envelope', () => {
  it('ok() wraps data with ok: true', () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 })
  })

  it('err() wraps a message with ok: false', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/result.test.ts`
Expected: FAIL — `Failed to resolve import "./result"` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/shared/result.ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err(message: string): Result<never> {
  return { ok: false, error: message }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/result.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/result.ts src/shared/result.test.ts
git commit -m "feat: add shared Result envelope with ok/err helpers"
```

---

## Task 4: Shared IPC contract + API surface

Define the channel names and the typed shape of `window.api` in `src/shared` so main, preload, and renderer all agree on one contract.

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/api.ts`

- [ ] **Step 1: Create `src/shared/ipc.ts`**

```ts
// src/shared/ipc.ts
import type { Result } from './result'

/** Canonical IPC channel names. Add new channels here in later plans. */
export const IPC = {
  ping: 'app:ping'
} as const

export interface PingPayload {
  pong: string
}

export type PingResult = Result<PingPayload>
```

- [ ] **Step 2: Create `src/shared/api.ts`** (the exact shape exposed as `window.api`)

```ts
// src/shared/api.ts
import type { PingResult } from './ipc'

/** The full surface the preload exposes to the renderer. Grows in later plans. */
export interface DbClientApi {
  ping(message: string): Promise<PingResult>
}
```

- [ ] **Step 3: Typecheck the Node project**

Run: `npm run typecheck:node`
Expected: PASS — no errors (shared modules compile).

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts
git commit -m "feat: define shared IPC contract and window.api surface"
```

---

## Task 5: Main process — window, security, and the ping handler

**Files:**
- Create: `src/main/index.ts`, `src/main/ipc.ts`

- [ ] **Step 1: Create `src/main/ipc.ts`** (registers all IPC handlers; one for now)

```ts
// src/main/ipc.ts
import { ipcMain } from 'electron'
import { IPC, type PingResult } from '../shared/ipc'
import { ok } from '../shared/result'

/** Register every main-process IPC handler. Called once on app ready. */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.ping, (_event, message: string): PingResult => {
    return ok({ pong: message })
  })
}
```

- [ ] **Step 2: Create `src/main/index.ts`** (bootstrap + secure BrowserWindow)

```ts
// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    window.loadURL(devUrl)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
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

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts src/main/ipc.ts
git commit -m "feat: add main process with secure window and ping IPC handler"
```

---

## Task 6: Preload bridge

**Files:**
- Create: `src/preload/index.ts`, `src/preload/index.d.ts`

- [ ] **Step 1: Create `src/preload/index.ts`** (expose the typed, narrow API)

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PingResult } from '../shared/ipc'
import type { DbClientApi } from '../shared/api'

const api: DbClientApi = {
  ping: (message: string): Promise<PingResult> => ipcRenderer.invoke(IPC.ping, message)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 2: Create `src/preload/index.d.ts`** (type `window.api` globally)

```ts
// src/preload/index.d.ts
import type { DbClientApi } from '../shared/api'

declare global {
  interface Window {
    api: DbClientApi
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: add preload contextBridge exposing typed window.api"
```

---

## Task 7: Renderer shell (proves the IPC round-trip)

A deliberately minimal React app: on mount it calls `window.api.ping('hello')` and renders the result. This is throwaway UI replaced in Plan 4 — its only job is to prove the boundary works end to end.

**Files:**
- Create: `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`

- [ ] **Step 1: Create `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>DB Client</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/renderer/src/env.d.ts`**

```ts
/// <reference types="vite/client" />
import type { DbClientApi } from '@shared/api'

declare global {
  interface Window {
    api: DbClientApi
  }
}
```

- [ ] **Step 3: Create `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'

export default function App(): JSX.Element {
  const [status, setStatus] = useState('pinging main…')

  useEffect(() => {
    window.api
      .ping('hello')
      .then((res) => {
        setStatus(res.ok ? `IPC ok: ${res.data.pong}` : `IPC error: ${res.error}`)
      })
      .catch((e: unknown) => setStatus(`IPC threw: ${String(e)}`))
  }, [])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>DB Client</h1>
      <p data-testid="ipc-status">{status}</p>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: add minimal renderer shell that exercises the IPC bridge"
```

---

## Task 8: Verify the whole thing runs and type-checks

No new code — this task is the proof gates. Do not proceed to Plan 2 until all three pass.

- [ ] **Step 1: Typecheck both projects**

Run: `npm run typecheck`
Expected: PASS — both `typecheck:node` and `typecheck:web` report no errors.

- [ ] **Step 2: Run unit tests**

Run: `npm test`
Expected: PASS — Vitest runs `src/shared/result.test.ts`, 2 tests green.

- [ ] **Step 3: Launch the app in dev and confirm the IPC round-trip**

Run: `npm run dev`
Expected: an Electron window opens showing the heading **DB Client** and the line **`IPC ok: hello`** (not "IPC error" / "IPC threw"). This confirms renderer → preload → main → preload → renderer works with context isolation on.
Then quit the app (Cmd+Q / close the window).

- [ ] **Step 4: Commit any fixes**

If Steps 1–3 required changes, commit them:
```bash
git add -A
git commit -m "fix: foundation verification fixes"
```
If nothing changed, skip this step.

---

## Task 9: Cross-platform packaging baseline

Prove the app can be packaged for all three OSes. Full code-signing/notarization is intentionally out of scope (deferred per spec).

**Files:**
- Create: `electron-builder.yml`
- Modify: `.gitignore` (ensure `dist/` and `out/` are ignored — already present from the repo `.gitignore`; verify)

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: com.jonathanariass.dbclient
productName: DB Client
directories:
  output: dist
  buildResources: build
files:
  - out/**/*
  - package.json
mac:
  target: dmg
  category: public.app-category.developer-tools
win:
  target: nsis
linux:
  target:
    - AppImage
    - deb
  category: Development
```

- [ ] **Step 2: Verify build artifacts are git-ignored**

Run: `git check-ignore out dist && echo OK`
Expected: prints `out`, `dist`, then `OK`. (Both are covered by the repo `.gitignore`. If `out/` is not listed, add a line `out/` to `.gitignore` and commit.)

- [ ] **Step 3: Build the renderer/main/preload bundles**

Run: `npm run build`
Expected: PASS — `electron-vite build` writes `out/main`, `out/preload`, `out/renderer` with no errors.

- [ ] **Step 4: Package for the current OS**

Run: `npm run package:mac` (or `package:linux` / `package:win` to match the build machine)
Expected: `electron-builder` produces an installer in `dist/` (e.g. `dist/DB Client-0.0.1.dmg`). Building for the other two OSes from one machine may need extra tooling — that's fine; one local target proves the config.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml .gitignore
git commit -m "build: add cross-platform electron-builder packaging baseline"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (for Plan 1's slice):** Electron + React + TS stack ✓ (Tasks 1–7); main/preload/renderer separation with `contextIsolation`/`nodeIntegration: false`/`sandbox` ✓ (Task 5–6); narrow typed `window.api` over IPC ✓ (Tasks 4,6); Vitest unit testing ✓ (Tasks 2–3, 8); electron-builder packaging for Win/Mac/Linux ✓ (Task 9). Persistence, secrets, drivers, Mongo parser, and the real UI are intentionally deferred to Plans 2–4.
- **Placeholder scan:** No TBD/TODO; every code step shows full file contents; every command lists expected output.
- **Type consistency:** `Result<T>`, `ok`/`err`, `IPC.ping`, `PingPayload`, `PingResult`, and `DbClientApi.ping(message)` are used identically across shared/main/preload/renderer.

## Definition of Done

`npm run typecheck`, `npm test`, and `npm run dev` (window shows `IPC ok: hello`) all pass, and `npm run package:<os>` emits an installer. On green, proceed to **Plan 2 — Persistence & Secrets**.
