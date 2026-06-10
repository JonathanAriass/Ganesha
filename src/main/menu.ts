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
    ...(isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    {
      label: 'File',
      submenu: [
        { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' },
        ...(isMac ? [] : ([{ role: 'quit' }] as MenuItemConstructorOptions[]))
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
