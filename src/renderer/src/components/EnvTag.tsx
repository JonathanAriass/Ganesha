import React from 'react'

export default function EnvTag({
  connection
}: {
  connection: { environment: string; color: string }
}): React.JSX.Element | null {
  if (!connection.environment) return null
  return (
    <span
      className="env-tag"
      style={{
        background: `color-mix(in srgb, ${connection.color} 22%, transparent)`,
        color: 'var(--text)'
      }}
    >
      {connection.environment}
    </span>
  )
}
