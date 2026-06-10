# Plan 4a — Live App Shell (ABI fix · introspection · connections · object tree)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the running app real for the first time: fix the better-sqlite3 Electron-ABI blocker (dual-ABI strategy), add schema introspection (`listObjects`/`describeObject`) to all drivers, and replace the placeholder renderer with the Midnight-themed shell — top bar with connection switcher, a working connection manager (create/test/edit/delete, persisted to SQLite, password in safeStorage), and a lazy object tree.

**Architecture:** The ABI fix keeps `better-sqlite3` (prod dep) rebuilt for **Electron** via a `postinstall` hook, while Vitest aliases `better-sqlite3` → a **Node-ABI npm-alias copy** (`better-sqlite3-node`, devDep) so the unit suite keeps running under Node. Introspection adds two methods to `DatabaseDriver` + two IPC channels (16→18). The renderer gains Zustand (app state) + TanStack Query (IPC data) and the first real components. No query editor yet (Plan 4b).

**Tech Stack:** `better-sqlite3-node` (npm alias), `zustand`, `@tanstack/react-query`. No Monaco/Table/Virtual yet.

**This is Plan 4a** (→ 4b query experience → 4c palette/settings/polish). Builds on `main` after Plan 3e. Docker required for the integration suite + the live demo.

---

## File Structure

```
package.json                       MODIFY — postinstall, better-sqlite3-node, zustand, react-query
vitest.config.ts / vitest.integration.config.ts   MODIFY — alias better-sqlite3 -> better-sqlite3-node
src/shared/schema.ts               CREATE — DbObject, ObjectRef, ColumnInfo (renderer-safe)
src/main/drivers/types.ts          MODIFY — re-export schema types; add listObjects/describeObject
src/main/drivers/sql/postgres.ts   MODIFY — introspection impl
src/main/drivers/sql/mysql.ts      MODIFY — introspection impl
src/main/drivers/mongo/mongo.ts    MODIFY — introspection impl
src/main/drivers/mongo/infer.ts    CREATE — inferFieldTypes (pure) + test
src/main/drivers/sql/*.integration.test.ts / mongo/*.integration.test.ts  MODIFY — +introspection tests
src/main/drivers/params.ts         CREATE — buildConnectParams(config, password)
src/main/query-service.ts          MODIFY — use buildConnectParams
src/shared/ipc.ts / api.ts, src/preload/index.ts, src/main/ipc.ts  MODIFY — schema.objects/schema.columns
src/main/index.ts                  MODIFY — backgroundColor #0f1117, min size
src/renderer/src/styles.css        CREATE — Midnight theme + all component styles
src/renderer/src/state/store.ts    CREATE — zustand app store
src/renderer/src/lib/result.ts     CREATE — unwrap()
src/renderer/src/lib/hooks.ts      CREATE — all TanStack Query hooks/mutations
src/renderer/src/components/{TopBar,Welcome,ConnectionModal,ObjectTree}.tsx  CREATE
src/renderer/src/App.tsx           MODIFY — real layout (ping UI removed; ping channel stays)
src/renderer/src/main.tsx          MODIFY — import styles.css
```

---

## Task 1: Dual-ABI better-sqlite3

- [ ] **Step 1:** `npm install -D better-sqlite3-node@npm:better-sqlite3@^11.10.0`
- [ ] **Step 2:** Add to `package.json` scripts: `"postinstall": "electron-builder install-app-deps"` (rebuilds prod-dep `better-sqlite3` for Electron's ABI; the devDep alias copy stays Node-ABI).
- [ ] **Step 3:** Add to BOTH `vitest.config.ts` and `vitest.integration.config.ts`, above `test:`:
```ts
  resolve: {
    // Tests run under Node while the app's better-sqlite3 is rebuilt for Electron's ABI.
    // Alias to a Node-ABI copy (npm-alias devDep) so the same sources load in both runtimes.
    alias: { 'better-sqlite3': 'better-sqlite3-node' }
  },
```
- [ ] **Step 4:** Run `npm install` (triggers postinstall → Electron rebuild). Then `npm test` → all green under the Node alias. `npm run typecheck && npm run lint` → clean. (Live Electron proof comes in Task 7.)
- [ ] **Step 5:** Commit: `build: dual-ABI better-sqlite3 (Electron rebuild via postinstall, Node alias for tests)`

## Task 2: Schema introspection (types + 3 drivers + tests)

- [ ] **Step 1:** Create `src/shared/schema.ts`:
```ts
export interface DbObject {
  schema: string | null
  name: string
  kind: 'table' | 'view' | 'collection'
}

export interface ObjectRef {
  schema: string | null
  name: string
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
}
```
- [ ] **Step 2:** In `src/main/drivers/types.ts`: add `import type { DbObject, ObjectRef, ColumnInfo } from '../../shared/schema'` + `export type { DbObject, ObjectRef, ColumnInfo }`, and add to `DatabaseDriver`:
```ts
  /** List user tables/views/collections visible on this connection. */
  listObjects(id: string): Promise<DbObject[]>
  /** Describe an object's columns/fields. */
  describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]>
```
- [ ] **Step 3:** `PostgresDriver` — add a private `requirePool(id)` (get-or-throw `Connection '${id}' is not open`) and:
```ts
  async listObjects(id: string): Promise<DbObject[]> {
    const res = await this.requirePool(id).query(
      `SELECT table_schema AS schema, table_name AS name,
              CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name`
    )
    return res.rows as DbObject[]
  }

  async describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]> {
    const res = await this.requirePool(id).query(
      `SELECT column_name AS name, data_type AS "dataType", (is_nullable = 'YES') AS nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [ref.schema ?? 'public', ref.name]
    )
    return res.rows as ColumnInfo[]
  }
```
- [ ] **Step 4:** `MySqlDriver` — same pattern with `requirePool`:
```ts
  async listObjects(id: string): Promise<DbObject[]> {
    const [rows] = await this.requirePool(id).query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS tableType
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
    )
    return (rows as { name: string; tableType: string }[]).map((r) => ({
      schema: null, name: r.name, kind: r.tableType === 'VIEW' ? ('view' as const) : ('table' as const)
    }))
  }

  async describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]> {
    const [rows] = await this.requirePool(id).query(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, (IS_NULLABLE = 'YES') AS nullable
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [ref.name]
    )
    return (rows as { name: string; dataType: string; nullable: number }[]).map((r) => ({
      name: r.name, dataType: r.dataType, nullable: !!r.nullable
    }))
  }
```
- [ ] **Step 5:** Create `src/main/drivers/mongo/infer.ts` (+ TDD test `infer.test.ts`: null→[], and a doc with ObjectId/string/number/array/object/Date/boolean/null mapping to objectId/string/number/array/object/date/boolean/null):
```ts
import type { ColumnInfo } from '../../../shared/schema'

function fieldTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof Date) return 'date'
  const bsonType = (v as { _bsontype?: string })._bsontype
  if (bsonType) return bsonType.charAt(0).toLowerCase() + bsonType.slice(1)
  if (typeof v === 'object') return 'object'
  return typeof v
}

/** Infer field names/types from a sample document (Mongo has no fixed schema). */
export function inferFieldTypes(doc: Record<string, unknown> | null): ColumnInfo[] {
  if (!doc) return []
  return Object.entries(doc).map(([name, v]) => ({ name, dataType: fieldTypeName(v), nullable: true }))
}
```
- [ ] **Step 6:** `MongoDriver` — add private `requireClient(id)` and:
```ts
  async listObjects(id: string): Promise<DbObject[]> {
    const cols = await this.requireClient(id).db().listCollections({}, { nameOnly: true }).toArray()
    return cols
      .map((c) => ({ schema: null, name: c.name, kind: 'collection' as const }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]> {
    const sample = await this.requireClient(id).db().collection(ref.name).findOne({})
    return inferFieldTypes(sample as Record<string, unknown> | null)
  }
```
- [ ] **Step 7:** Append one introspection test to EACH integration suite: pg (`CREATE TABLE t_intro (a int NOT NULL, b text)` → listObjects contains `{schema:'public',name:'t_intro',kind:'table'}`; describe → `[{name:'a',dataType:'integer',nullable:false},{name:'b',dataType:'text',nullable:true}]`), mysql (same shape, `schema: null`, dataType `int`/`text`), mongo (listObjects contains `users`; describe contains `_id`+`name`).
- [ ] **Step 8:** `npm run typecheck && npm run lint && npm test` green (infer test included). Commit: `feat: add schema introspection (listObjects/describeObject) to all drivers`

## Task 3: Schema IPC channels + params helper

- [ ] **Step 1:** Create `src/main/drivers/params.ts`:
```ts
import type { ConnectionConfig } from '../../shared/domain'
import type { ConnectParams } from './types'

/** Build driver ConnectParams from a stored config + its secret. */
export function buildConnectParams(config: ConnectionConfig, password: string | null): ConnectParams {
  return {
    id: config.id, type: config.type, host: config.host, port: config.port,
    username: config.username, password, database: config.database, ssl: config.ssl
  }
}
```
- [ ] **Step 2:** `src/main/query-service.ts` — replace the inline `driver.connect({...})` object with `await driver.connect(buildConnectParams(config, secrets.getPassword(config.id)))`.
- [ ] **Step 3:** `src/shared/ipc.ts` — `import type { DbObject, ObjectRef, ColumnInfo } from './schema'` and add channels:
```ts
  'schema.objects': { req: string; res: DbObject[] }
  'schema.columns': { req: { connectionId: string; ref: ObjectRef }; res: ColumnInfo[] }
```
- [ ] **Step 4:** `src/shared/api.ts` — add group (import `ObjectRef` from './schema'):
```ts
  schema: {
    objects(connectionId: string): Promise<IpcResult<'schema.objects'>>
    columns(connectionId: string, ref: ObjectRef): Promise<IpcResult<'schema.columns'>>
  }
```
- [ ] **Step 5:** `src/preload/index.ts` — add:
```ts
  schema: {
    objects: (connectionId) => invoke('schema.objects', connectionId),
    columns: (connectionId, ref) => invoke('schema.columns', { connectionId, ref })
  }
```
- [ ] **Step 6:** `src/main/ipc.ts` — import `buildConnectParams`, add handlers:
```ts
  handle('schema.objects', async (connectionId) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const driver = drivers.get(c.type)
    await driver.connect(buildConnectParams(c, secrets.getPassword(c.id)))
    return ok(await driver.listObjects(c.id))
  })
  handle('schema.columns', async ({ connectionId, ref }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const driver = drivers.get(c.type)
    await driver.connect(buildConnectParams(c, secrets.getPassword(c.id)))
    return ok(await driver.describeObject(c.id, ref))
  })
```
- [ ] **Step 7:** Gate green. Commit: `feat: expose schema introspection over typed IPC (18 channels)`

## Task 4: Renderer foundation (theme, store, hooks, layout)

- [ ] **Step 1:** `npm install zustand@^4.5.4 @tanstack/react-query@^5.51.0`
- [ ] **Step 2:** `src/main/index.ts` — add to the BrowserWindow options: `backgroundColor: '#0f1117', minWidth: 940, minHeight: 600,` (dark flash prevention + sane floor).
- [ ] **Step 3:** Create `src/renderer/src/styles.css` — Midnight tokens + all classes used by Tasks 4-6 (`:root` vars `--bg #0f1117, --bg-2 #13161f, --bg-3 #1b1f2c, --border #232838, --text #e3e7f0, --text-2 #8b93a7, --accent #6366f1, --danger #ef4444, --ok #22c55e`; base/reset; `.app` column layout; `.topbar` (flex, bg-2, border-bottom) with `.brand`, `.conn-dot` (10px circle), `.conn-select`, `.spacer`, `.btn`/`.btn.primary`/`.btn.ghost`/`.btn.danger`; `.app-body` flex; `.sidebar` (260px, bg-2, border-right, overflow auto); `.main` (flex 1, overflow auto); `.welcome` centered + `.error`; `.modal-overlay` (fixed, rgba backdrop) + `.modal` (420px card, bg-2, border, radius 8) + `.form-grid`/`.form-row`/`label`/`input,select` dark styles + `.color-swatches`/`.swatch`/`.swatch.selected` + `.modal-footer` + `.status.ok`/`.status.err`; tree classes `.tree`, `.tree-schema` (uppercase text-2), `.tree-node`, `.tree-row` (ghost button row, hover bg-3), `.tree-caret`, `.obj-icon` (.table indigo/.view cyan/.collection green tint), `.tree-label`, `.tree-children` (indent + left border), `.tree-col` (mono, flex between) with `.col-name`/`.col-type` (text-2), `.tree-muted`, `.tree-error`, `.sidebar-empty`; thin dark scrollbars).
- [ ] **Step 4:** Create `src/renderer/src/state/store.ts` (zustand): `activeConnectionId: string | null` + setter; `connectionModal: { mode:'create' } | { mode:'edit'; id:string } | null` + open/close.
- [ ] **Step 5:** Create `src/renderer/src/lib/result.ts` (`unwrap<T>(res: Result<T>): T` — throw `new Error(res.error)` when `!res.ok`) and `src/renderer/src/lib/hooks.ts` with ALL hooks: `useConnections` (['connections'] → `window.api.connections.list()`), `useObjects(connectionId)` (enabled when non-null, `retry: false`), `useColumns(connectionId, ref, enabled)` (key `['columns', id, ref.schema, ref.name]`, `retry: false`), `useSaveConnection` (create when no id / update when id; edit password semantics: `undefined` keeps, string sets; invalidates ['connections']), `useDeleteConnection` (invalidates), `useTestConnection` (`connections.test(input, password)`).
- [ ] **Step 6:** Replace `src/renderer/src/App.tsx`: QueryClientProvider (`refetchOnWindowFocus: false`) wrapping `.app` = `<TopBar/>` + `.app-body` (`.sidebar`→`<ObjectTree/>`, `.main`→`<Welcome/>`) + conditional `<ConnectionModal/>`. Update `src/renderer/src/main.tsx` to `import './styles.css'`.
- [ ] **Step 7:** Create `TopBar.tsx` (brand; color dot of active; native `<select>` of connections — option label `name (type)` + ` 🔒` when readOnly, '' option “— no connection —”; Edit button when active; spacer; `+ New connection` primary button) and `Welcome.tsx` (loading / error (shows IPC/SQLite failures!) / no-connections CTA / pick-one / connected blurb).
- [ ] **Step 8:** Gate green (typecheck:web compiles the new tree). Commit: `feat: midnight app shell (theme, store, hooks, topbar, welcome)`

## Task 5: Connection manager modal

- [ ] **Step 1:** Create `src/renderer/src/components/ConnectionModal.tsx`: controlled `ConnectionInput` form initialized from store mode (edit pre-fills from `useConnections`; create uses defaults `{type:'postgres', name:'', color:#6366f1, host:'localhost', port:5432, username:'', database:'', ssl:false, readOnly:false}`); type select switches port to the new type's default when the port still equals the old default (`{postgres:5432,mysql:3306,mariadb:3306,mongodb:27017}`); 6 color swatches; ssl + readOnly checkboxes; password field (`placeholder` on edit: “leave blank to keep current”); **Test** button → `useTestConnection` (pending “Testing…”, success “✓ Connection OK”, error message in `.status.err`); **Save** (disabled unless name+host+port valid) → `useSaveConnection` then `setActiveConnection(saved.id)` + close; **Delete** (edit only, `window.confirm`) → `useDeleteConnection`, clear active if it was active, close; **Cancel** → close. Errors from save shown inline.
- [ ] **Step 2:** Gate green. Commit: `feat: connection manager modal (create/test/edit/delete)`

## Task 6: Object tree

- [ ] **Step 1:** Create `src/renderer/src/components/ObjectTree.tsx`: from `activeConnectionId` → `useObjects`; group by `schema` (null → flat); `<ObjectNode>` per object holds local `expanded` state and calls `useColumns(connectionId, ref, expanded)`; row = caret + kind icon (T/V/C with kind-colored chip) + name; children = column rows (`name` + `dataType`, ` • not null` marker), loading/error/`no fields` states; sidebar-level states for no-connection/loading/error/empty.
- [ ] **Step 2:** Gate green. Commit: `feat: lazy object tree (schemas -> objects -> columns)`

## Task 7: Verification (controller-driven)

- [ ] Gates: `npm run typecheck && npm run lint && npm test`. Integration: `npm run test:integration` (now 12 tests incl. introspection).
- [ ] Live demo: start a demo Postgres (`docker run -d --name dbclient-demo -e POSTGRES_PASSWORD=demo -p 55432:5432 postgres:16-alpine`), seed two tables, `npm run dev`, user creates the connection in the UI (Test → OK → Save), sees the object tree + columns, restarts the app, connection persists (**the live ABI proof**).

## Self-Review (plan author)

- **Spec slice:** connection manager (all fields incl. SSL/read-only/color, test-before-save) ✓ T5; lazy object browser (schemas→objects→columns) ✓ T2/T3/T6; Midnight theme ✓ T4; persistence live in Electron ✓ T1/T7. Query editor/grid → 4b; ⌘K/Settings/light theme/indexes in tree → 4c.
- **Placeholder scan:** Task 4 Step 3 describes the stylesheet by exhaustive class list rather than full CSS (a style sheet, not logic — the class contract is fully enumerated and every class is referenced by listed components). All logic steps carry full code.
- **Type consistency:** `DbObject/ObjectRef/ColumnInfo` defined once in `shared/schema.ts`; channels↔api↔preload↔handlers aligned (18); `buildConnectParams` reused by query-service + both schema handlers.

## Definition of Done

Gates + integration green; in the running app: create→test→save a real Postgres connection, browse its tree (schema→tables→columns), restart, connection persists. On green → **Plan 4b — Query experience** (Monaco, run/cancel, virtualized grid, document view, history).
