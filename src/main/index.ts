import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { openDb } from './persistence/db'
import { getSettings } from './persistence/settings'

/**
 * Match the window background to the saved theme so launch doesn't flash
 * the wrong color. Guarded: a broken better-sqlite3 must never stop the
 * app from launching (openDb is deliberately lazy everywhere else).
 */
function windowBackground(): string {
  try {
    return getSettings(openDb()).theme === 'light' ? '#f7f8fa' : '#0f1117'
  } catch {
    return '#0f1117'
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: windowBackground(),
    minWidth: 940,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  // The renderer shows DB-sourced content; it must never become a browser.
  // Deny popups outright and block navigation away from the app itself
  // (dev-server full reloads emit will-navigate to the same dev origin — allowed).
  // Compared by origin, not string prefix: "http://localhost:5173.evil.com"
  // must not pass for a devUrl of "http://localhost:5173".
  const navigationAllowed = (url: string): boolean => {
    try {
      return Boolean(devUrl && new URL(url).origin === new URL(devUrl).origin)
    } catch {
      return false // unparseable URL → deny
    }
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!navigationAllowed(url)) event.preventDefault()
  })
  // Server-side redirects bypass will-navigate; hold them to the same policy.
  win.webContents.on('will-redirect', (event, url) => {
    if (!navigationAllowed(url)) event.preventDefault()
  })

  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  installAppMenu()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
