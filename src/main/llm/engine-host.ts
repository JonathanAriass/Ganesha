import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { LlmMessage } from '../../shared/domain'
import type { EngineRequest, EngineResponse } from './engine-protocol'

interface Pending {
  onToken?: (s: string) => void
  resolve: (value: string) => void
  reject: (err: Error) => void
}

/** Omit that distributes over a discriminated union so each variant keeps its own fields. */
type WithoutReqId<T> = T extends unknown ? Omit<T, 'reqId'> : never

/**
 * Runs the LLM engine in an Electron utilityProcess. A native llama.cpp/ggml abort (SIGABRT) can't
 * be caught by any JS try/catch — it takes down whatever process it runs in — so hosting it out of
 * the main process is the only way to keep the app alive. On the child's `exit`, every in-flight
 * request is rejected with a friendly error and the child is dropped; the next call lazily respawns.
 *
 * Mirrors the LlmEngine surface (load / isLoaded / generate / unload) so ipc.ts is unchanged.
 */
export class EngineHost {
  private child: UtilityProcess | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<string, Pending>()
  private loaded = false
  private seq = 0
  private binsDir: string | null = null

  /** Point the child at a downloaded-binaries dir (exported as GANESHA_LLAMA_BINS_DIR). Set before
   *  the first load(); a change only takes effect after the child is (re)spawned. */
  setBinsDir(dir: string | null): void {
    this.binsDir = dir
  }

  private ensureChild(): Promise<void> {
    if (this.child && this.ready) return this.ready
    const env: Record<string, string> = { ...(process.env as Record<string, string>) }
    if (this.binsDir) env.GANESHA_LLAMA_BINS_DIR = this.binsDir
    const child = utilityProcess.fork(join(__dirname, 'engine-worker.js'), [], {
      serviceName: 'ganesha-llm-engine',
      env,
      // Our llama.cpp binaries are unsigned; permit dlopen'ing them under a hardened runtime.
      allowLoadingUnsignedLibraries: true,
    })
    this.child = child
    this.ready = new Promise<void>((resolve) => {
      child.on('message', (msg: EngineResponse) => {
        if (msg.type === 'ready') resolve()
        else this.onMessage(msg)
      })
    })
    child.on('exit', (code) => this.onExit(code))
    return this.ready
  }

  private onMessage(msg: Exclude<EngineResponse, { type: 'ready' }>): void {
    const p = this.pending.get(msg.reqId)
    if (!p) return
    switch (msg.type) {
      case 'token':
        p.onToken?.(msg.chunk)
        break
      case 'loaded':
        this.loaded = true
        this.pending.delete(msg.reqId)
        p.resolve('')
        break
      case 'unloaded':
        this.loaded = false
        this.pending.delete(msg.reqId)
        p.resolve('')
        break
      case 'done':
        this.pending.delete(msg.reqId)
        p.resolve(msg.full)
        break
      case 'error':
        this.pending.delete(msg.reqId)
        p.reject(new Error(msg.message))
        break
    }
  }

  private onExit(code: number): void {
    const err = new Error(
      code === 0
        ? 'The AI engine stopped.'
        : 'The AI engine crashed (a model or inference error). The app is unaffected — reopen the assistant to try again.'
    )
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.child = null
    this.ready = null
    this.loaded = false
  }

  private request(req: WithoutReqId<EngineRequest>): Promise<string> {
    const reqId = `r${++this.seq}`
    return new Promise<string>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject })
      this.child!.postMessage({ ...req, reqId })
    })
  }

  async load(modelPath: string): Promise<void> {
    await this.ensureChild()
    await this.request({ type: 'load', modelPath })
  }

  isLoaded(): boolean {
    return this.loaded
  }

  async generate(
    systemPrompt: string,
    history: LlmMessage[],
    userText: string,
    onChunk: (s: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    await this.ensureChild()
    const reqId = `r${++this.seq}`
    return new Promise<string>((resolve, reject) => {
      this.pending.set(reqId, { onToken: onChunk, resolve, reject })
      const onAbort = (): void => { this.child?.postMessage({ type: 'cancel', reqId }) }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      this.child!.postMessage({ type: 'generate', reqId, systemPrompt, history, userText })
    })
  }

  async unload(): Promise<void> {
    if (!this.child) return
    await this.request({ type: 'unload' }).catch(() => undefined)
  }

  /** Hard-stop the child (app quit / reset). Rejects any in-flight work and drops the child. */
  kill(): void {
    const child = this.child
    this.onExit(0)
    try { child?.kill() } catch { /* already gone */ }
  }
}
