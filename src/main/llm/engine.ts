import type { LlmMessage } from '../../shared/domain'

// node-llama-cpp is ESM-only + native; loaded via dynamic import so the bundled
// CJS main never tries to `require` it (see the Task 1 spike). The library's own
// object types are large/opaque, so the loaded handles are kept loosely typed.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** One history entry in node-llama-cpp's chat format. */
type ChatItem =
  | { type: 'system'; text: string }
  | { type: 'user'; text: string }
  | { type: 'model'; response: string[] }

function toChatHistory(systemPrompt: string, history: LlmMessage[]): ChatItem[] {
  const items: ChatItem[] = [{ type: 'system', text: systemPrompt }]
  for (const m of history) {
    if (m.role === 'user') items.push({ type: 'user', text: m.content })
    else items.push({ type: 'model', response: [m.content] })
  }
  return items
}

export class LlmEngine {
  private llama: any = null
  private model: any = null
  private modelPath: string | null = null

  async load(modelPath: string): Promise<void> {
    if (this.modelPath === modelPath && this.model) return
    await this.unload()
    const { getLlama } = await import('node-llama-cpp')
    this.llama = this.llama ?? (await getLlama())
    this.model = await this.llama.loadModel({ modelPath })
    this.modelPath = modelPath
  }

  isLoaded(): boolean {
    return this.model !== null
  }

  /** Run one turn. A fresh context+session per call keeps state simple; prior
   *  turns are replayed via setChatHistory (no re-inference). Streams via
   *  onChunk. A user abort (signal) ends cleanly, returning the partial text. */
  async generate(
    systemPrompt: string,
    history: LlmMessage[],
    userText: string,
    onChunk: (s: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.model) throw new Error('No model loaded')
    const { LlamaChatSession } = await import('node-llama-cpp')
    const context = await this.model.createContext()
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence() })
      session.setChatHistory(toChatHistory(systemPrompt, history))
      let full = ''
      try {
        await session.prompt(userText, { onTextChunk: (c: string) => { full += c; onChunk(c) }, signal })
      } catch (e) {
        // A user-initiated Stop aborts the prompt — keep the partial answer.
        if (signal.aborted) return full
        throw e
      }
      return full
    } finally {
      await context.dispose()
    }
  }

  async unload(): Promise<void> {
    if (this.model) { await this.model.dispose(); this.model = null; this.modelPath = null }
  }
}
