import { Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Replace the default application menu so CmdOrCtrl+W reaches the renderer
 * (it closes the active query tab there); window close moves to
 * Shift+CmdOrCtrl+W. Standard roles are kept — without editMenu, ⌘C/⌘V/⌘X
 * keyboard editing stops working on macOS.
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    // Build the macOS app menu explicitly instead of role: 'appMenu' so the
    // About/Hide/Quit items read "Ganesha", not app.getName() — which stays
    // 'db-client' on purpose (renaming it repoints the safeStorage keychain; see
    // the App identity note in src/main/index.ts). macOS ignores the top-level
    // label (it shows the bundle name) but honors these explicit item labels.
    ...(isMac
      ? ([
          {
            label: 'Ganesha',
            submenu: [
              { role: 'about', label: 'About Ganesha' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide Ganesha' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit Ganesha' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' },
        ...(isMac ? [] : ([{ role: 'quit' }] as MenuItemConstructorOptions[]))
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // On mac the windowMenu role is Minimize/Zoom/Front — no close item. On
    // win/linux it would add Close with the default CmdOrCtrl+W accelerator,
    // eating the tab-close chord again, so build it without one.
    ...(isMac
      ? ([{ role: 'windowMenu' }] as MenuItemConstructorOptions[])
      : ([
          { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
        ] as MenuItemConstructorOptions[]))
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
