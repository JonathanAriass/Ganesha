// Message protocol between the main-process EngineHost and the utilityProcess engine-worker.
import type { LlmMessage } from '../../shared/domain'

/** main → worker */
export type EngineRequest =
  | { type: 'load'; reqId: string; modelPath: string }
  | { type: 'generate'; reqId: string; systemPrompt: string; history: LlmMessage[]; userText: string }
  | { type: 'cancel'; reqId: string }
  | { type: 'unload'; reqId: string }

/** worker → main */
export type EngineResponse =
  | { type: 'ready' }
  | { type: 'loaded'; reqId: string }
  | { type: 'unloaded'; reqId: string }
  | { type: 'token'; reqId: string; chunk: string }
  | { type: 'done'; reqId: string; full: string }
  | { type: 'error'; reqId: string; message: string }
