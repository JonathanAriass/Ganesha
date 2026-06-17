import { useRef, useState } from 'react'
import type { EditableResult } from '@shared/query'
import { editKey, getAtPath, isEjsonWrapper, isKeyPath } from '../lib/doc-path'
import { coerceMongoEditValue } from '../lib/mongo-edit-value'
import { cellText } from '../lib/grid-text'
import { useAppStore } from '../state/store'
import EditingCell from './EditingCell'

interface Props {
  documents: Record<string, unknown>[]
  tabId?: string
  /** Non-null when the result is editable (a find over one collection); enables leaf edits. */
  editable?: EditableResult | null
  readOnly?: boolean
  requireCommit?: boolean
  edits?: Record<string, unknown>
}

/** What recursive JsonNode needs to render and edit leaves. */
interface EditCtx {
  tabId?: string
  editable?: EditableResult | null
  readOnly?: boolean
  edits: Record<string, unknown>
  editing: string | null
  setEditing: (k: string | null) => void
  stage: (rowIndex: number, path: string, value: unknown) => void
  reset: (k: string) => void
}

/** Render a leaf value with the JSON syntax colors (objects/EJSON wrappers via cellText). */
function leafValueEl(value: unknown): JSX.Element {
  if (value === null || value === undefined) return <span className="json-null">NULL</span>
  if (typeof value === 'string') return <span className="json-string">{`"${value}"`}</span>
  if (typeof value === 'number') return <span className="json-number">{String(value)}</span>
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>
  return <span>{cellText(value)}</span> // EJSON wrapper ({$oid}/{$date}) or other
}

interface JsonNodeProps {
  name: string
  value: unknown
  depth: number
  rowIndex: number
  /** Dotted path from the document root ('' for the document itself). */
  path: string
  ctx: EditCtx
}

function JsonNode({ name, value, depth, rowIndex, path, ctx }: JsonNodeProps): JSX.Element {
  // A plain object/array is a container; an EJSON wrapper ({$oid}/{$date}) is a leaf value.
  if (value !== null && typeof value === 'object' && !isEjsonWrapper(value)) {
    const isArray = Array.isArray(value)
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value as Record<string, unknown>)
    const hint = isArray ? `[${entries.length}]` : '{…}'
    return (
      <details open={depth === 0} style={{ marginLeft: depth > 0 ? 14 : 0 }}>
        <summary>
          <span className="json-key">{name}</span>
          {': '}
          <span style={{ color: 'var(--text-2)', fontSize: '11px' }}>{hint}</span>
        </summary>
        {entries.map(([k, v]) => (
          <JsonNode key={k} name={k} value={v} depth={depth + 1} rowIndex={rowIndex} path={path ? `${path}.${k}` : k} ctx={ctx} />
        ))}
      </details>
    )
  }

  // Leaf.
  const k = editKey(rowIndex, path)
  const isDirty = Object.prototype.hasOwnProperty.call(ctx.edits, k)
  const shown = isDirty ? ctx.edits[k] : value
  const canEdit =
    !!ctx.editable && !ctx.readOnly && path !== '' && !isKeyPath(path, ctx.editable.keyColumns)

  if (ctx.editing === k) {
    return (
      <div style={{ marginLeft: 14 }}>
        <span className="json-key">{name}</span>
        {': '}
        <EditingCell
          className="doc-editing"
          initial={shown}
          onCommit={(v) => ctx.stage(rowIndex, path, v)}
          onCancel={() => ctx.setEditing(null)}
        />
      </div>
    )
  }

  return (
    <div style={{ marginLeft: 14 }} className={isDirty ? 'doc-leaf cell-dirty' : 'doc-leaf'}>
      <span className="json-key">{name}</span>
      {': '}
      <span
        className={canEdit ? 'doc-editable' : undefined}
        onDoubleClick={canEdit ? () => ctx.setEditing(k) : undefined}
      >
        {leafValueEl(shown)}
      </span>
      {isDirty && ctx.tabId && (
        <button className="cell-reset doc-reset" title="Reset this field" onClick={() => ctx.reset(k)}>
          ↺
        </button>
      )}
    </div>
  )
}

export default function DocumentView({ documents, tabId, editable, readOnly, requireCommit, edits = {} }: Props): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  // Drop a stale in-progress edit when a new result replaces the documents.
  const docsRef = useRef(documents)
  if (docsRef.current !== documents) {
    docsRef.current = documents
    if (editing) setEditing(null)
  }

  const stage = (rowIndex: number, path: string, value: unknown): void => {
    setEditing(null) // close the editor regardless
    if (!tabId) return
    const original = getAtPath(documents[rowIndex], path)
    useAppStore.getState().setCellEdit(tabId, editKey(rowIndex, path), coerceMongoEditValue(value as string | null, original))
    if (!requireCommit) void useAppStore.getState().commitEdits(tabId)
  }
  const reset = (k: string): void => {
    if (tabId) useAppStore.getState().resetCellEdit(tabId, k)
  }

  const ctx: EditCtx = { tabId, editable, readOnly, edits, editing, setEditing, stage, reset }

  return (
    <div className="doc-view">
      {documents.map((doc, i) => (
        <JsonNode key={i} name={String(i)} value={doc} depth={0} rowIndex={i} path="" ctx={ctx} />
      ))}
    </div>
  )
}
