import type { ReactNode } from 'react'
import type { ObjectRef } from '@shared/schema'
import { useTableInfo } from '../lib/hooks'

/** Humanize a byte count (1 KB = 1024 B). */
function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** A titled card with a count badge; `empty` shows a "None" placeholder instead of the body. */
function Card({ title, count, empty, children }: { title: string; count: number; empty?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className="ti-card">
      <div className="ti-card-head">
        <span className="ti-card-title">{title}</span>
        <span className="ti-card-count">{count}</span>
      </div>
      {empty ? <div className="ti-empty">None</div> : children}
    </div>
  )
}

/** The read-only "Table info" tab — a scannable, full-width view of one table/collection's
 *  structure: columns flow in responsive sub-columns; the smaller sections sit in a card row.
 *  Sections an engine lacks (e.g. Mongo foreign keys/constraints) are hidden or show "None". */
export default function TableInfoView({ connectionId, objectRef }: { connectionId: string; objectRef: ObjectRef }): JSX.Element {
  const { data: info, isLoading, error } = useTableInfo(connectionId, objectRef)

  if (isLoading) return <div className="ti-view"><div className="ti-status">Loading…</div></div>
  if (error) return <div className="ti-view"><pre className="qt-error">{error instanceof Error ? error.message : String(error)}</pre></div>
  if (!info) return <div className="ti-view"><div className="ti-status">No info.</div></div>

  const fkCols = new Set(info.foreignKeys.flatMap((f) => f.columns))

  const chips: string[] = [
    plural(info.columns.length, 'column', 'columns'),
    plural(info.indexes.length, 'index', 'indexes'),
    plural(info.foreignKeys.length, 'foreign key', 'foreign keys'),
  ]
  const sizeBits: string[] = []
  if (info.size?.rowEstimate != null) sizeBits.push(`~${info.size.rowEstimate.toLocaleString()} rows`)
  if (info.size?.bytes != null) sizeBits.push(bytesLabel(info.size.bytes))

  return (
    <div className="ti-view">
      <div className="ti-content">
        <div className="ti-header">
          <div className="ti-name">
            {objectRef.schema && <span className="ti-schema">{objectRef.schema}.</span>}
            {objectRef.name}
          </div>
          <div className="ti-chips">
            {chips.map((c) => <span key={c} className="ti-chip">{c}</span>)}
            {sizeBits.length > 0 && <span className="ti-chip ti-chip-soft">{sizeBits.join(' · ')}</span>}
          </div>
        </div>

        <Card title="Columns" count={info.columns.length}>
          <div className="ti-col-list">
            {info.columns.map((c) => (
              <div className="ti-col-item" key={c.name}>
                <span className="ti-col-name" title={c.name}>{c.name}</span>
                <span className="ti-col-type" title={c.dataType}>{c.dataType}</span>
                <span className="ti-col-flags">
                  {c.primaryKey && <span className="ti-pill pk">PK</span>}
                  {fkCols.has(c.name) && <span className="ti-pill fk">FK</span>}
                  {!c.nullable && <span className="ti-tag">NOT NULL</span>}
                  {c.default != null && c.default !== '' && (
                    <span className="ti-tag">default <span className="ti-mono">{c.default}</span></span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <div className="ti-cards-grid">
          <Card title="Indexes" count={info.indexes.length} empty={info.indexes.length === 0}>
            {info.indexes.map((ix) => (
              <div className="ti-row2" key={ix.name}>
                <div className="ti-row2-top">
                  <span className="ti-mono ti-row2-name" title={ix.name}>{ix.name}</span>
                  {ix.unique && <span className="ti-pill uniq">UNIQUE</span>}
                  {ix.primary && <span className="ti-pill pk">PK</span>}
                </div>
                <div className="ti-row2-sub">
                  <span className="ti-mono">({ix.columns.join(', ')})</span>
                  {ix.method && <span className="ti-soft"> · {ix.method}</span>}
                </div>
              </div>
            ))}
          </Card>

          <Card title="Foreign keys" count={info.foreignKeys.length} empty={info.foreignKeys.length === 0}>
            {info.foreignKeys.map((fk, i) => (
              <div className="ti-rel" key={fk.name ?? i}>
                <span className="ti-mono">{fk.columns.join(', ')}</span>
                <span className="ti-arrow">→</span>
                <span className="ti-mono">{fk.refTable}<span className="ti-soft">({fk.refColumns.join(', ')})</span></span>
              </div>
            ))}
          </Card>

          {info.referencedBy.length > 0 && (
            <Card title="Referenced by" count={info.referencedBy.length}>
              {info.referencedBy.map((fk, i) => (
                <div className="ti-rel" key={fk.name ?? i}>
                  <span className="ti-mono">{fk.refTable}<span className="ti-soft">({fk.refColumns.join(', ')})</span></span>
                  <span className="ti-arrow">→</span>
                  <span className="ti-mono">{fk.columns.join(', ')}</span>
                </div>
              ))}
            </Card>
          )}

          {info.constraints.length > 0 && (
            <Card title="Constraints" count={info.constraints.length}>
              {info.constraints.map((c) => (
                <div className="ti-row2" key={c.name}>
                  <div className="ti-row2-top">
                    <span className="ti-mono ti-row2-name" title={c.name}>{c.name}</span>
                    <span className="ti-pill uniq">{c.type}</span>
                  </div>
                  <div className="ti-row2-sub ti-mono ti-soft">{c.detail}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
