# Resizable results columns — design

**Goal:** Let users resize columns in the results grid — drag a column's right edge to set its width, or double-click the handle to auto-fit the column to its content.

## Current state

`ResultsGrid.tsx` is a hand-rolled CSS-grid: `.grid-head` and every `.grid-row` get
`grid-template-columns: repeat(N, minmax(140px, 1fr))` inline, plus a `minWidth` for
horizontal scroll. TanStack handles sorting/filtering/row-model only — not column sizing.

## Behavior

- **Drag** a handle on the right edge of a column header → that column gets a fixed pixel
  width. **Double-click** the handle → auto-fit to the widest loaded value (header + all
  loaded rows; rows are virtualized so only loaded data is measured). Min width 64px, max
  600px.
- Columns the user hasn't touched keep `minmax(140px, 1fr)` (fill). A resized column locks to
  px. Grid scrolls horizontally when the total exceeds the viewport.
- Widths are **ephemeral**: reset to the fill layout when `columns` changes (a new query).
  Not persisted (YAGNI).

## Implementation

**Layout via CSS variable (perf).** Move the template to `--grid-cols` and the scroll min-width
to `--grid-min`, set on `.grid-wrap`. `.grid-head` and `.grid-row` read
`grid-template-columns: var(--grid-cols)`; the rows wrapper uses `min-width: var(--grid-min)`.
During a drag, update the two custom properties **directly on the `.grid-wrap` DOM node** (one
write updates every row via CSS — no React re-render of the virtualized grid per frame); commit
the new width to state on pointer-up (the editor-splitter pattern).

**State.** `widths: Record<colIndex, number>` in `ResultsGrid`, reset when `columns` changes
(render-phase guard, like the existing `editing`/`sel` resets).

**Resize handle.** Each header cell gets `position: relative` and an absolutely-positioned
`.col-resizer` at its right edge (`cursor: col-resize`). `onPointerDown` starts the drag
(window `pointermove`/`pointerup` listeners); `onDoubleClick` auto-fits. The handle calls
`stopPropagation` so dragging never triggers the header's sort `onClick`.

**Auto-fit measurement.** A canvas 2D context (font read from a rendered grid cell) measures the
header label and each loaded cell's `cellText`. The pixel math is the pure
`autoFitWidth(headerText, cellTexts, measure)` with the measurer injected.

**Pure module `lib/column-size.ts`** (unit-tested):
- `MIN_COL_WIDTH = 64`, `MAX_COL_WIDTH = 600`, `DEFAULT_COL_WIDTH = 140`
- `clampColumnWidth(px)` → clamp + round
- `buildGridTemplate(count, widths)` → `"…px"` for resized columns, `"minmax(140px, 1fr)"` otherwise
- `gridMinWidth(count, widths)` → sum of widths (default 140 for untouched)
- `autoFitWidth(headerText, cellTexts, measure, padding=24)` → clamped widest + padding

## Out of scope (YAGNI)

Persisting widths across queries/restarts; column reorder; hide/show columns. Re-running a
query resets widths to the fill layout.

## Testing

`lib/column-size.ts` unit-tested (clamp bounds, template string for mixed resized/untouched,
min-width sum, auto-fit picks the widest + padding + clamp). Drag/auto-fit DOM wiring verified
live in the running app. Pure renderer change — integration suite not affected.
