/** Right-dock state: which panel (if any) is open. Clicking the open panel's
 *  button closes it; clicking the other one switches. */
export type DockTab = 'assistant' | 'tunnels'

export function toggleDock(current: DockTab | null, target: DockTab): DockTab | null {
  return current === target ? null : target
}
