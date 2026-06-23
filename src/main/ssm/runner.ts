import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { homedir } from 'os'
import type { SsmTunnel } from '../../shared/domain'
import { buildSsmArgs } from './command'

type OutputCb = (id: string, chunk: string) => void
type StatusCb = (id: string, running: boolean, code: number | null) => void

let cachedPath: string | null = null

/** A macOS GUI app doesn't inherit the shell PATH, so `aws` (homebrew/pyenv/…) wouldn't resolve.
 *  Resolve the user's real PATH once via a login+interactive shell; markers skip any startup noise. */
function resolveUserPath(): string {
  if (cachedPath != null) return cachedPath
  const fallback = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:${homedir()}/.local/bin`
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-ilc', 'printf "__P__%s__E__" "$PATH"'], { encoding: 'utf8', timeout: 4000 })
    const m = out.match(/__P__(.*)__E__/s)
    cachedPath = m && m[1] ? m[1] : fallback
  } catch {
    cachedPath = fallback
  }
  return cachedPath
}

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
