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
