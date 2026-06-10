import { useAppStore } from '../state/store'
import { useSettings, useSetSetting, useDataDir, useSetDataDir } from '../lib/hooks'
import { unwrap } from '../lib/result'

export default function SettingsModal(): JSX.Element {
  const closeSettings = useAppStore((s) => s.closeSettings)

  const { data: settings } = useSettings()
  const { data: dataDir } = useDataDir()
  const setSetting = useSetSetting()
  const setDataDir = useSetDataDir()

  const theme = settings?.theme ?? 'midnight'

  async function changeDataDir(): Promise<void> {
    const dir = await window.api.dialog.pickDirectory().then(unwrap)
    if (dir) setDataDir.mutate(dir)
  }

  return (
    <div className="modal-overlay" onClick={closeSettings}>
      <div
        className="modal"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Settings</h2>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label>Theme</label>
              <div className="seg" role="radiogroup" aria-label="Theme">
                <button
                  className={`seg-btn${theme === 'midnight' ? ' active' : ''}`}
                  onClick={() => setSetting.mutate({ key: 'theme', value: 'midnight' })}
                >
                  Midnight
                </button>
                <button
                  className={`seg-btn${theme === 'light' ? ' active' : ''}`}
                  onClick={() => setSetting.mutate({ key: 'theme', value: 'light' })}
                >
                  Light
                </button>
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
              {setDataDir.isError && (
                <div className="status err" role="alert">
                  {setDataDir.error instanceof Error
                    ? setDataDir.error.message
                    : String(setDataDir.error)}
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
