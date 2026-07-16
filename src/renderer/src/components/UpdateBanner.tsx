import { useEffect, useState } from 'react'
import { unwrap } from '../lib/result'

const DISMISS_KEY = 'update-dismissed'

/**
 * On mount, asks the main process whether a newer release exists and, if so, shows a dismissible
 * banner pointing at `brew upgrade`. Renders nothing when up-to-date, offline, in dev (main returns
 * null when not packaged), or already dismissed for that version.
 */
export default function UpdateBanner(): JSX.Element | null {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null)
  useEffect(() => {
    void window.api.update
      .check()
      .then(unwrap)
      .then((u) => {
        if (u && localStorage.getItem(DISMISS_KEY) !== u.version) setUpdate(u)
      })
      .catch(() => {}) // offline / any failure → no banner
  }, [])

  if (!update) return null
  const cmd = 'brew upgrade --cask ganesha'
  return (
    <div className="update-banner" role="status">
      <span className="update-msg">
        <strong>Ganesha {update.version}</strong> is available.
      </span>
      <code className="update-cmd">{cmd}</code>
      <button className="btn ghost" onClick={() => void window.api.clipboard.copy(cmd)}>
        Copy
      </button>
      <button className="btn ghost" onClick={() => void window.api.shell.openExternal(update.url)}>
        Release notes
      </button>
      <span className="spacer" />
      <button
        className="update-dismiss"
        aria-label="Dismiss update notice"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, update.version)
          setUpdate(null)
        }}
      >
        ×
      </button>
    </div>
  )
}
