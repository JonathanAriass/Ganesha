# Object-tree name filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fuzzy, case-insensitive name filter to the sidebar object tree so a long list of tables/views/collections can be narrowed by typing.

**Architecture:** Pure subsequence matcher in `src/renderer/src/lib/object-filter.ts` (unit-tested, no React), wired into `ObjectTree.tsx` via a sticky filter input. Matches object names and schema names; filters in original order; matched characters are bolded. Ephemeral component state, cleared on connection switch. No store/IPC/driver changes.

**Tech Stack:** TypeScript, React, Vitest. `DbObject` from `@shared/schema` (`{ schema: string | null, name: string, kind: 'table' | 'view' | 'collection' }`).

---

### Task 1: Pure matcher `fuzzyMatch`

**Files:**
- Create: `src/renderer/src/lib/object-filter.ts`
- Test: `src/renderer/src/lib/object-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './object-filter'

describe('fuzzyMatch', () => {
  it('matches an exact substring and returns its positions', () => {
    expect(fuzzyMatch('user', 'users')).toEqual([0, 1, 2, 3])
  })
  it('matches a gapped subsequence (chars in order, not adjacent)', () => {
    expect(fuzzyMatch('usr', 'users')).toEqual([0, 1, 3]) // u, s, (e skipped), r
  })
  it('is case-insensitive but returns indices into the original target', () => {
    expect(fuzzyMatch('US', 'users')).toEqual([0, 1])
  })
  it('returns null when not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'users')).toBeNull()
    expect(fuzzyMatch('sru', 'users')).toBeNull() // wrong order
  })
  it('returns null when the query is longer than the target', () => {
    expect(fuzzyMatch('userss', 'users')).toBeNull()
  })
  it('returns [] for an empty query (matches everything, no highlight)', () => {
    expect(fuzzyMatch('', 'users')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/object-filter.test.ts`
Expected: FAIL — `fuzzyMatch is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DbObject } from '@shared/schema'

/** Case-insensitive greedy subsequence match. Returns the matched character
 *  indices in `target` (for highlighting), or null if `query` is not a
 *  subsequence of `target`. An empty query returns [] (matches everything). */
export function fuzzyMatch(query: string, target: string): number[] | null {
  if (query === '') return []
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const positions: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti)
      qi++
    }
  }
  return qi === q.length ? positions : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/object-filter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/object-filter.ts src/renderer/src/lib/object-filter.test.ts
git commit -m "feat: fuzzyMatch subsequence matcher for object-tree filter"
```

---

### Task 2: `objectMatches` and `filterObjects`

**Files:**
- Modify: `src/renderer/src/lib/object-filter.ts`
- Test: `src/renderer/src/lib/object-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `object-filter.test.ts`:

```ts
import { objectMatches, filterObjects } from './object-filter'
import type { DbObject } from '@shared/schema'

const OBJECTS: DbObject[] = [
  { schema: 'public', name: 'users', kind: 'table' },
  { schema: 'public', name: 'orders', kind: 'table' },
  { schema: 'sales', name: 'invoices', kind: 'table' }
]

describe('objectMatches', () => {
  it('matches on the object name', () => {
    expect(objectMatches(OBJECTS[0], 'usr')).toBe(true)
  })
  it('matches on the schema name (surfaces the whole schema)', () => {
    expect(objectMatches(OBJECTS[2], 'sales')).toBe(true)
  })
  it('is true for an empty query', () => {
    expect(objectMatches(OBJECTS[1], '')).toBe(true)
  })
  it('is false when neither name nor schema matches', () => {
    expect(objectMatches(OBJECTS[1], 'xyz')).toBe(false)
  })
})

describe('filterObjects', () => {
  it('keeps matches in original order', () => {
    expect(filterObjects(OBJECTS, 'es').map((o) => o.name)).toEqual(['users', 'invoices'])
  })
  it('returns all objects for an empty query', () => {
    expect(filterObjects(OBJECTS, '')).toEqual(OBJECTS)
  })
  it('includes every object of a schema matched by name', () => {
    expect(filterObjects(OBJECTS, 'sales').map((o) => o.name)).toEqual(['invoices'])
  })
})
```

Note: `'es'` is a subsequence of `usERS` (e@3? no) — verify: `users` has e at index 3? `u s e r s` → e at index 2, s at 4 → `es` = e then s = [2,4] ✓; `orders` = `o r d e r s` → e@3, s@5 ✓ also matches. Adjust expectation below.

- [ ] **Step 2: Fix the test expectation to reality, then run to verify it fails**

`'es'` matches `users`, `orders`, AND `invoices` (`i n v o i c e s` → e@6, s@7). Update the first `filterObjects` test:

```ts
  it('keeps matches in original order', () => {
    expect(filterObjects(OBJECTS, 'es').map((o) => o.name)).toEqual(['users', 'orders', 'invoices'])
  })
```

Run: `npx vitest run src/renderer/src/lib/object-filter.test.ts`
Expected: FAIL — `objectMatches`/`filterObjects` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `object-filter.ts`:

```ts
/** True when the object should be shown for `query`: empty query → true; else a
 *  fuzzy hit on the object name OR on its schema name. */
export function objectMatches(obj: DbObject, query: string): boolean {
  if (query === '') return true
  if (fuzzyMatch(query, obj.name) !== null) return true
  return obj.schema !== null && fuzzyMatch(query, obj.schema) !== null
}

/** The objects to show, in original order (no re-ranking). Empty query → all. */
export function filterObjects(objects: DbObject[], query: string): DbObject[] {
  if (query === '') return objects
  return objects.filter((o) => objectMatches(o, query))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/object-filter.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/object-filter.ts src/renderer/src/lib/object-filter.test.ts
git commit -m "feat: objectMatches + filterObjects for object-tree filter"
```

---

### Task 3: Wire the filter input into ObjectTree

**Files:**
- Modify: `src/renderer/src/components/ObjectTree.tsx`

- [ ] **Step 1: Import the filter + React hooks**

At the top of `ObjectTree.tsx`, change the React import and add the lib import:

```ts
import { useEffect, useState } from 'react'
import { filterObjects, fuzzyMatch } from '../lib/object-filter'
```

- [ ] **Step 2: Add a `Highlighted` helper component**

Add above `ObjectTree` (after the `ObjectNode` definition):

```tsx
/** Renders `text`, bolding the characters at `positions` (a fuzzyMatch result). */
function Highlighted({ text, positions }: { text: string; positions: number[] }): JSX.Element {
  if (positions.length === 0) return <>{text}</>
  const set = new Set(positions)
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? <b key={i} className="tree-match">{ch}</b> : <span key={i}>{ch}</span>
      )}
    </>
  )
}
```

- [ ] **Step 3: Pass the query down to ObjectNode and highlight the name**

Change `ObjectNodeProps` and the label render. Update the interface:

```ts
interface ObjectNodeProps {
  connectionId: string
  obj: DbObject
  query: string
  onDoubleClick: (obj: DbObject) => void
}
```

Update the `ObjectNode` signature to destructure `query`, and replace the label span:

```tsx
        <span className="tree-label">
          <Highlighted text={obj.name} positions={fuzzyMatch(query, obj.name) ?? []} />
        </span>
```

(`fuzzyMatch` returns `null` when the object matched only via its schema — `?? []` then yields no highlight.)

- [ ] **Step 4: Add filter state + reset-on-connection-change in ObjectTree**

Inside `ObjectTree`, after the existing hooks (`const activeConn = ...`), add:

```ts
  const [query, setQuery] = useState('')
  // Objects differ per connection — a stale filter would hide everything.
  useEffect(() => setQuery(''), [activeConnectionId])
```

- [ ] **Step 5: Render the sticky filter input + filtered content**

Replace the success-path return (the `if (!hasSchemas) { return ... }` block and the grouped `return (...)` block at the end) with a single structure. Concretely, replace from `// Group by schema:` through the end of the function with:

```tsx
  // Group by schema: if any object has a non-null schema, group them. Decided from
  // the ORIGINAL objects so the layout doesn't flip between grouped/flat while typing.
  const hasSchemas = objects.some((o) => o.schema !== null)
  const filtered = filterObjects(objects, query)

  const filterBar = (
    <div className="tree-filter">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
        }}
        placeholder="Filter tables…"
        aria-label="Filter database objects by name"
        spellCheck={false}
      />
      {query && (
        <button className="tree-filter-clear" onClick={() => setQuery('')} aria-label="Clear filter">
          ×
        </button>
      )}
    </div>
  )

  if (filtered.length === 0) {
    return (
      <nav className="tree" aria-label="Database objects">
        {filterBar}
        <div className="tree-muted">No tables match “{query}”</div>
      </nav>
    )
  }

  if (!hasSchemas) {
    return (
      <nav className="tree" aria-label="Database objects">
        {filterBar}
        {filtered.map((obj) => (
          <ObjectNode
            key={`${obj.schema ?? ''}:${obj.name}`}
            connectionId={activeConnectionId}
            obj={obj}
            query={query}
            onDoubleClick={handleDoubleClick}
          />
        ))}
      </nav>
    )
  }

  // Build groups preserving insertion order (over the FILTERED set, so empty
  // schema groups disappear).
  const groups = new Map<string, DbObject[]>()
  for (const obj of filtered) {
    const key = obj.schema ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(obj)
  }

  return (
    <nav className="tree" aria-label="Database objects">
      {filterBar}
      {Array.from(groups.entries()).map(([schema, objs]) => (
        <div key={schema}>
          {schema && (
            <div className="tree-schema" aria-label={`Schema: ${schema}`}>
              {schema}
            </div>
          )}
          {objs.map((obj) => (
            <ObjectNode
              key={`${obj.schema ?? ''}:${obj.name}`}
              connectionId={activeConnectionId}
              obj={obj}
              query={query}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </div>
      ))}
    </nav>
  )
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ObjectTree.tsx
git commit -m "feat: filter input + match highlighting in ObjectTree"
```

---

### Task 4: Style the filter bar (sticky, clear button, highlight)

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Find the existing tree styles for context**

Run: `grep -n "\.tree\b\|\.tree-row\|\.tree-muted\|\.tree-schema" src/renderer/src/styles.css`
Expected: locates the `.tree*` block to add the new rules near.

- [ ] **Step 2: Add the filter-bar CSS**

Add near the other `.tree*` rules in `styles.css` (use the app's existing CSS variables — confirm names like `--bg`, `--border`, `--text`, `--accent` exist in `:root` via `grep -n "^  --" src/renderer/src/styles.css` and substitute the real ones):

```css
.tree-filter {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.tree-filter input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel, var(--bg));
  border: 1px solid var(--border);
  border-radius: 4px;
}
.tree-filter input:focus {
  outline: none;
  border-color: var(--accent);
}
.tree-filter-clear {
  flex: none;
  width: 20px;
  height: 20px;
  line-height: 1;
  color: var(--text-muted, var(--text));
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.tree-filter-clear:hover {
  background: var(--border);
}
.tree-match {
  color: var(--accent);
  font-weight: 700;
}
```

- [ ] **Step 3: Verify the dev app**

Run (if not already running): `nohup npm run dev >/tmp/dbdev.log 2>&1 & disown`
Manually confirm in the app with a connection selected:
- The filter input is pinned at the top of the object tree and stays visible while scrolling.
- Typing a fuzzy query (e.g. `usr`) narrows the list; matched characters are bolded/accented.
- The `×` button and the Escape key both clear the filter.
- A no-match query shows `No tables match "…"`.
- Switching the active connection clears the filter.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "style: sticky object-tree filter bar + match highlight"
```

---

### Task 5: Final gates

- [ ] **Step 1: Run the full unit suite + typecheck + lint**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all green; `object-filter.test.ts` included in the count.

- [ ] **Step 2: Update README feature list**

In `README.md`, extend the Schema browser bullet (line ~12) to mention the filter, e.g. append: ` Filter the list by name with a fuzzy search box at the top of the tree.` Bump the unit-test count on the `npm test` line to the new total.

- [ ] **Step 3: Commit the docs**

```bash
git add README.md
git commit -m "docs: README — object-tree name filter"
```

---

## Self-Review notes

- **Spec coverage:** fuzzyMatch/objectMatches/filterObjects (Tasks 1–2), sticky input + clear + Escape + reset-on-connection (Task 3 Steps 4–5), filtered grouping with original `hasSchemas` (Task 3 Step 5), highlight (Task 3 Steps 2–3 + Task 4), no-match state (Task 3 Step 5), styling (Task 4). All spec sections covered.
- **Out of scope honored:** no column matching, no persistence, no re-ranking.
- **Type consistency:** `fuzzyMatch(query, target) → number[] | null`; `objectMatches(obj, query)`; `filterObjects(objects, query)` used identically across tasks. `ObjectNode` gains a `query: string` prop everywhere it is rendered.
- **CSS variable caveat:** Task 4 Step 2 instructs verifying real `--*` variable names before pasting; `--panel`/`--text-muted` have `var(..., fallback)` guards in case they don't exist.
