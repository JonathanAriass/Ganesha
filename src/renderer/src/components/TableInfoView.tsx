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

/** The read-only "Table info" tab — a scannable, card-based view of one table/collection's
 *  structure. Sections an engine lacks (e.g. Mongo foreign keys/constraints) are hidden. */
export default function TableInfoView({ connectionId, objectRef }: { connectionId: string; objectRef: ObjectRef }): JSX.Element {
  const { data: info, isLoading, error } = useTableInfo(connectionId, objectRef)

  if (isLoading) return <div className="ti-view"><div className="ti-status">Loading…</div></div>
  if (error) return <div className="ti-view"><pre className="qt-error">{error instanceof Error ? error.message : String(error)}</pre></div>
  if (!info) return <div className="ti-view"><div className="ti-status">No info.</div></div>

  // A column is a foreign key if it participates in any outgoing FK.
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
          <table className="ti-table">
            <tbody>
              {info.columns.map((c) => (
                <tr key={c.name}>
                  <td className="ti-name-cell">{c.name}</td>
                  <td className="ti-type-cell">{c.dataType}</td>
                  <td className="ti-tags-cell">
                    {c.primaryKey && <span className="ti-pill pk">PK</span>}
                    {fkCols.has(c.name) && <span className="ti-pill fk">FK</span>}
                    {!c.nullable && <span className="ti-tag">NOT NULL</span>}
                    {c.default != null && c.default !== '' && (
                      <span className="ti-tag soft">default <span className="ti-mono">{c.default}</span></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Indexes" count={info.indexes.length} empty={info.indexes.length === 0}>
          <table className="ti-table">
            <tbody>
              {info.indexes.map((ix) => (
                <tr key={ix.name}>
                  <td className="ti-name-cell">
                    {ix.name}
                    {ix.primary && <span className="ti-pill pk ti-pill-after">PK</span>}
                  </td>
                  <td className="ti-mono ti-cols-cell">({ix.columns.join(', ')})</td>
                  <td className="ti-tags-cell">
                    {ix.unique && <span className="ti-pill uniq">UNIQUE</span>}
                    {ix.method && <span className="ti-tag soft">{ix.method}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Foreign keys" count={info.foreignKeys.length} empty={info.foreignKeys.length === 0}>
          {info.foreignKeys.map((fk, i) => (
            <div className="ti-rel" key={fk.name ?? i}>
              <span className="ti-mono ti-rel-from">{fk.columns.join(', ')}</span>
              <span className="ti-arrow">→</span>
              <span className="ti-mono">{fk.refTable}<span className="ti-soft">({fk.refColumns.join(', ')})</span></span>
            </div>
          ))}
        </Card>

        {info.referencedBy.length > 0 && (
          <Card title="Referenced by" count={info.referencedBy.length}>
            {info.referencedBy.map((fk, i) => (
              <div className="ti-rel" key={fk.name ?? i}>
                <span className="ti-mono ti-rel-from">{fk.refTable}<span className="ti-soft">({fk.refColumns.join(', ')})</span></span>
                <span className="ti-arrow">→</span>
                <span className="ti-mono">{fk.columns.join(', ')}</span>
              </div>
            ))}
          </Card>
        )}

        {info.constraints.length > 0 && (
          <Card title="Constraints" count={info.constraints.length}>
            <table className="ti-table">
              <tbody>
                {info.constraints.map((c) => (
                  <tr key={c.name}>
                    <td className="ti-name-cell">{c.name}</td>
                    <td className="ti-tags-cell"><span className="ti-pill uniq">{c.type}</span></td>
                    <td className="ti-mono ti-soft ti-detail-cell">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
