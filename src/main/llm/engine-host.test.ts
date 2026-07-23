import { describe, it, expect, vi, beforeEach } from 'vitest'

// A controllable stand-in for an Electron utilityProcess child.
const hoisted = vi.hoisted(() => {
  class FakeChild {
    posted: Record<string, unknown>[] = []
    killed = false
    private listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
    postMessage(msg: Record<string, unknown>): void { this.posted.push(msg) }
    kill(): void { this.killed = true }
    on(ev: string, fn: (...a: unknown[]) => void): this { (this.listeners[ev] ??= []).push(fn); return this }
    emit(ev: string, ...args: unknown[]): void { for (const fn of this.listeners[ev] ?? []) fn(...args) }
    reqIdOf(type: string): string { return this.posted.find((m) => m.type === type)!.reqId as string }
  }
  return { forkCalls: [] as FakeChild[], FakeChild }
})

vi.mock('electron', () => ({
  utilityProcess: { fork: () => { const c = new hoisted.FakeChild(); hoisted.forkCalls.push(c); return c } }
}))

import { EngineHost } from './engine-host'

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

/** Drive a host to a loaded state; returns its (latest) fake child. */
async function loaded(host: EngineHost): Promise<InstanceType<typeof hoisted.FakeChild>> {
  const p = host.load('/m.gguf')
  const c = hoisted.forkCalls.at(-1)!
  c.emit('message', { type: 'ready' })
  await flush()
  c.emit('message', { type: 'loaded', reqId: c.reqIdOf('load') })
  await p
  return c
}

beforeEach(() => { hoisted.forkCalls.length = 0 })

describe('EngineHost', () => {
  it('spawns a worker, loads, and streams a generation to completion', async () => {
    const host = new EngineHost()
    const c = await loaded(host)
    expect(host.isLoaded()).toBe(true)
    expect(hoisted.forkCalls).toHaveLength(1)

    const tokens: string[] = []
    const genP = host.generate('sys', [], 'hi', (t) => tokens.push(t), new AbortController().signal)
    await flush()
    const reqId = c.reqIdOf('generate')
    c.emit('message', { type: 'token', reqId, chunk: 'Hel' })
    c.emit('message', { type: 'token', reqId, chunk: 'lo' })
    c.emit('message', { type: 'done', reqId, full: 'Hello' })
    await expect(genP).resolves.toBe('Hello')
    expect(tokens).toEqual(['Hel', 'lo'])
  })

  it('a worker crash rejects the in-flight request but keeps the host alive + respawns', async () => {
    const host = new EngineHost()
    const c1 = await loaded(host)

    const genP = host.generate('sys', [], 'hi', () => {}, new AbortController().signal)
    await flush()
    c1.emit('exit', 134) // native SIGABRT → abnormal child exit
    await expect(genP).rejects.toThrow(/crashed/i)
    expect(host.isLoaded()).toBe(false)

    // next call lazily respawns a fresh worker
    const c2 = await loaded(host)
    expect(hoisted.forkCalls).toHaveLength(2)
    expect(c2).not.toBe(c1)
    expect(host.isLoaded()).toBe(true)
  })

  it('forwards cancel to the worker when the signal aborts, and returns the partial answer', async () => {
    const host = new EngineHost()
    const c = await loaded(host)
    const ac = new AbortController()
    const genP = host.generate('sys', [], 'hi', () => {}, ac.signal)
    await flush()
    const reqId = c.reqIdOf('generate')
    ac.abort()
    expect(c.posted).toContainEqual({ type: 'cancel', reqId })
    c.emit('message', { type: 'done', reqId, full: 'partial' }) // worker returns partial on abort
    await expect(genP).resolves.toBe('partial')
  })

  it('kill() stops the child and rejects in-flight work without throwing', async () => {
    const host = new EngineHost()
    const c = await loaded(host)
    const genP = host.generate('s', [], 'h', () => {}, new AbortController().signal)
    await flush()
    host.kill()
    await expect(genP).rejects.toThrow()
    expect(c.killed).toBe(true)
    expect(host.isLoaded()).toBe(false)
  })
})
