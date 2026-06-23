import { spawn, type ChildProcess } from 'child_process'
import type { SsmTunnel } from '../../shared/domain'
import { buildSsmArgs } from './command'
import { resolveUserPath } from './aws'

type OutputCb = (id: string, chunk: string) => void
type StatusCb = (id: string, running: boolean, code: number | null) => void

/** Spawns and tracks `aws ssm start-session` port-forwarding processes by tunnel id, streaming their
 *  output and surfacing start/exit status. Stopping kills the whole process group so the
 *  session-manager-plugin child dies too. */
export class SsmRunner {
  private procs = new Map<string, ChildProcess>()

  constructor(private onOutput: OutputCb, private onStatus: StatusCb) {}

  isRunning(id: string): boolean {
    return this.procs.has(id)
  }
  running(): string[] {
    return [...this.procs.keys()]
  }

  start(tunnel: SsmTunnel): void {
    if (this.procs.has(tunnel.id)) return // already running
    const child = spawn('aws', buildSsmArgs(tunnel), {
      env: { ...process.env, PATH: resolveUserPath() },
      detached: true, // own process group → stop() can kill the plugin child too
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.procs.set(tunnel.id, child)
    this.onStatus(tunnel.id, true, null)

    child.stdout?.on('data', (d: Buffer) => this.onOutput(tunnel.id, d.toString()))
    child.stderr?.on('data', (d: Buffer) => this.onOutput(tunnel.id, d.toString()))
    child.on('error', (e) => {
      this.onOutput(tunnel.id, `\n[failed to start: ${e.message}]\n`)
      this.cleanup(tunnel.id, null)
    })
    child.on('exit', (code) => this.cleanup(tunnel.id, code))
  }

  stop(id: string): void {
    const child = this.procs.get(id)
    if (!child) return
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM') // negative pid = the whole process group
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
    // The 'exit' handler does the cleanup + status.
  }

  stopAll(): void {
    for (const id of this.running()) this.stop(id)
  }

  private cleanup(id: string, code: number | null): void {
    this.procs.delete(id)
    this.onStatus(id, false, code)
  }
}
