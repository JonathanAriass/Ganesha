import { useState } from 'react'
import { THEMES, type ThemeMeta } from '@shared/domain'
import { useAppStore } from '../state/store'
import { useSettings, useSetSetting, useDataDir, useSetDataDir } from '../lib/hooks'
import { unwrap } from '../lib/result'
import { useRestoreFocus } from '../lib/use-restore-focus'

export default function SettingsModal(): JSX.Element {
  const closeSettings = useAppStore((s) => s.closeSettings)

  const { data: settings } = useSettings()
  const { data: dataDir } = useDataDir()
  const setSetting = useSetSetting()
  const setDataDir = useSetDataDir()
  const [pickError, setPickError] = useState<string | null>(null)

  useRestoreFocus()

  const theme = settings?.theme ?? 'midnight'

  const renderTheme = (t: ThemeMeta): JSX.Element => (
    <button
      key={t.id}
      role="radio"
      aria-checked={theme === t.id}
      className={`theme-opt${theme === t.id ? ' active' : ''}`}
      onClick={() => setSetting.mutate({ key: 'theme', value: t.id })}
    >
      <span className="tchip" style={{ background: t.bg }}>
        <i style={{ background: t.accent }} />
      </span>
      {t.label}
    </button>
  )

  async function changeDataDir(): Promise<void> {
    setPickError(null)
    try {
      const dir = await window.api.dialog.pickDirectory().then(unwrap)
      if (dir) setDataDir.mutate(dir)
    } catch (e) {
      // The picker itself failing is near-impossible, but a swallowed error
      // would leave the button looking dead — surface it like mutation errors.
      setPickError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    // mousedown + target guard, not click: a drag that starts inside the modal
    // and releases over the backdrop must not dismiss it.
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSettings()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-header">
          <h2>Settings</h2>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label>Theme</label>
              <div role="radiogroup" aria-label="Theme">
                <div className="theme-group-label">Dark</div>
                <div className="theme-list">
                  {THEMES.filter((t) => t.mode === 'dark').map(renderTheme)}
                </div>
                <div className="theme-group-label">Light</div>
                <div className="theme-list">
                  {THEMES.filter((t) => t.mode === 'light').map(renderTheme)}
                </div>
              </div>
            </div>

            <div className="form-row">
              <label>Data directory</label>
              <div className="datadir-row">
                <code className="datadir-path" title={dataDir ?? ''}>
                  {dataDir ?? '…'}
                </code>
                <button
                  className="btn"
                  onClick={() => void changeDataDir()}
                  disabled={setDataDir.isPending}
                >
                  {setDataDir.isPending ? 'Moving…' : 'Change…'}
                </button>
              </div>
              <p className="form-hint">
                Connections, history and settings live here. Changing it copies your data
                to the new folder.
              </p>
              {(pickError !== null || setDataDir.isError) && (
                <div className="status err" role="alert">
                  {pickError ??
                    (setDataDir.error instanceof Error
                      ? setDataDir.error.message
                      : String(setDataDir.error))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn primary" onClick={closeSettings}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
