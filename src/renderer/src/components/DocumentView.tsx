interface Props {
  documents: Record<string, unknown>[]
}

interface JsonNodeProps {
  name: string
  value: unknown
  depth: number
}

function JsonNode({ name, value, depth }: JsonNodeProps): JSX.Element {
  if (value !== null && typeof value === 'object') {
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
          <JsonNode key={k} name={k} value={v} depth={depth + 1} />
        ))}
      </details>
    )
  }

  // primitive
  let valueEl: JSX.Element
  if (value === null || value === undefined) {
    valueEl = <span className="json-null">NULL</span>
  } else if (typeof value === 'string') {
    valueEl = <span className="json-string">{`"${value}"`}</span>
  } else if (typeof value === 'number') {
    valueEl = <span className="json-number">{String(value)}</span>
  } else if (typeof value === 'boolean') {
    valueEl = <span className="json-bool">{String(value)}</span>
  } else {
    valueEl = <span>{String(value)}</span>
  }

  return (
    <div style={{ marginLeft: 14 }}>
      <span className="json-key">{name}</span>
      {': '}
      {valueEl}
    </div>
  )
}

export default function DocumentView({ documents }: Props): JSX.Element {
  return (
    <div className="doc-view">
      {documents.map((doc, i) => (
        <JsonNode key={i} name={String(i)} value={doc} depth={0} />
      ))}
    </div>
  )
}
