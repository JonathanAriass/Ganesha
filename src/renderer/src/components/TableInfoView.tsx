import type { ReactNode } from 'react'
import type { ObjectRef } from '@shared/schema'
import { useTableInfo } from '../lib/hooks'

/** Humanize a byte count (1 KB = 1024 B). */
function bytesLabel(n: number | null): string {
  if (n == null) return ''
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

function Section({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }): JSX.Element {
  return (
    <div className="info-section">
      <div className="info-section-title">{title}</div>
      {empty ? <div className="info-empty-row">None</div> : children}
    </div>
  )
}

/** The read-only "Table info" tab: columns, indexes, foreign keys, constraints, and size for one
 *  table/collection. Sections an engine lacks (e.g. Mongo foreign keys) are hidden. */
export default function TableInfoView({ connectionId, objectRef }: { connectionId: string; objectRef: ObjectRef }): JSX.Element {
  const { data: info, isLoading, error } = useTableInfo(connectionId, objectRef)

  if (isLoading) return <div className="info-view"><div className="info-empty">Loading…</div></div>
  if (error) return <div className="info-view"><pre className="qt-error">{error instanceof Error ? error.message : String(error)}</pre></div>
  if (!info) return <div className="info-view"><div className="info-empty">No info.</div></div>

  const sizeBits: string[] = []
  if (info.size?.rowEstimate != null) sizeBits.push(`~${info.size.rowEstimate.toLocaleString()} rows`)
  if (info.size?.bytes != null) sizeBits.push(bytesLabel(info.size.bytes))

  return (
    <div className="info-view">
      <div className="info-head">
        <span className="info-title">{objectRef.schema ? `${objectRef.schema}.` : ''}{objectRef.name}</span>
        {sizeBits.length > 0 && <span className="info-size">{sizeBits.join(' · ')}</span>}
      </div>

      <Section title={`Columns (${info.columns.length})`}>
        <table className="info-table">
          <thead><tr><th>Name</th><th>Type</th><th>Null</th><th>Default</th><th>Key</th></tr></thead>
          <tbody>
            {info.columns.map((c) => (
              <tr key={c.name}>
                <td className="info-mono">{c.name}</td>
                <td>{c.dataType}</td>
                <td>{c.nullable ? 'yes' : 'no'}</td>
                <td className="info-mono info-muted">{c.default ?? ''}</td>
                <td>{c.primaryKey && <span className="info-badge pk">PK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Indexes (${info.indexes.length})`} empty={info.indexes.length === 0}>
        <table className="info-table">
          <thead><tr><th>Name</th><th>Columns</th><th>Unique</th><th>Type</th></tr></thead>
          <tbody>
            {info.indexes.map((ix) => (
              <tr key={ix.name}>
                <td className="info-mono">{ix.name}{ix.primary && <span className="info-badge pk info-inline">PK</span>}</td>
                <td className="info-mono">{ix.columns.join(', ')}</td>
                <td>{ix.unique ? 'yes' : 'no'}</td>
                <td className="info-muted">{ix.method ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Foreign keys (${info.foreignKeys.length})`} empty={info.foreignKeys.length === 0}>
        <table className="info-table">
          <thead><tr><th>Columns</th><th></th><th>References</th></tr></thead>
          <tbody>
            {info.foreignKeys.map((fk, i) => (
              <tr key={fk.name ?? i}>
                <td className="info-mono">{fk.columns.join(', ')}</td>
                <td className="info-muted">→</td>
                <td className="info-mono">{fk.refTable}({fk.refColumns.join(', ')})</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {info.referencedBy.length > 0 && (
        <Section title={`Referenced by (${info.referencedBy.length})`}>
          <table className="info-table">
            <thead><tr><th>From</th><th></th><th>Columns</th></tr></thead>
            <tbody>
              {info.referencedBy.map((fk, i) => (
                <tr key={fk.name ?? i}>
                  <td className="info-mono">{fk.refTable}({fk.refColumns.join(', ')})</td>
                  <td className="info-muted">→</td>
                  <td className="info-mono">{fk.columns.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {info.constraints.length > 0 && (
        <Section title={`Constraints (${info.constraints.length})`}>
          <table className="info-table">
            <thead><tr><th>Name</th><th>Type</th><th>Detail</th></tr></thead>
            <tbody>
              {info.constraints.map((c) => (
                <tr key={c.name}>
                  <td className="info-mono">{c.name}</td>
                  <td>{c.type}</td>
                  <td className="info-mono info-muted">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}
