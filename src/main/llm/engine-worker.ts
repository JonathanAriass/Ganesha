// Electron utilityProcess entry: hosts the LlmEngine (node-llama-cpp) in a SEPARATE process so a
// native llama.cpp/ggml abort (std::terminate → SIGABRT — uncatchable by JS) kills only this child,
// never the main app. Talks to the main-process EngineHost over process.parentPort.
//
// The binaries dir is passed in via env GANESHA_LLAMA_BINS_DIR (read by the patched node-llama-cpp
// config); nothing here needs to know where the binaries live.
import { LlmEngine } from './engine'
import type { EngineRequest, EngineResponse } from './engine-protocol'

// Electron injects process.parentPort in utilityProcess children (not in @types/node's Process).
// Typed structurally to avoid depending on Electron's exact type exports for a worker entry.
interface ParentPortLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (e: { data: unknown }) => void): void
}
const parentPort = (process as unknown as { parentPort: ParentPortLike }).parentPort

const engine = new LlmEngine()
const aborters = new Map<string, AbortController>()

function post(msg: EngineResponse): void {
  parentPort.postMessage(msg)
}

async function handle(msg: EngineRequest): Promise<void> {
  try {
    switch (msg.type) {
      case 'load':
        await engine.load(msg.modelPath)
        post({ type: 'loaded', reqId: msg.reqId })
        break
      case 'generate': {
        const ac = new AbortController()
        aborters.set(msg.reqId, ac)
        try {
          const full = await engine.generate(
            msg.systemPrompt, msg.history, msg.userText,
            (chunk) => post({ type: 'token', reqId: msg.reqId, chunk }),
            ac.signal
          )
          post({ type: 'done', reqId: msg.reqId, full })
        } finally {
          aborters.delete(msg.reqId)
        }
        break
      }
      case 'cancel':
        aborters.get(msg.reqId)?.abort()
        break
      case 'unload':
        await engine.unload()
        post({ type: 'unloaded', reqId: msg.reqId })
        break
    }
  } catch (e) {
    post({ type: 'error', reqId: msg.reqId, message: e instanceof Error ? e.message : String(e) })
  }
}

parentPort.on('message', (e) => {
  void handle(e.data as EngineRequest)
})

post({ type: 'ready' })
