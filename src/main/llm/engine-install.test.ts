import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import {
  ENGINE_NLC_VERSION, ENGINE_VARIANT, engineRootFor, engineBinsDir, isEngineInstalledAt,
  downloadAndExtractEngine, engineTarballUrl, type FetchLike
} from './engine-install'

const tmps: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'eng-')); tmps.push(d); return d }
afterEach(() => { for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true }) })

function fakeFetch(bytes: Buffer, headers: Record<string, string> = {}): (url: string) => Promise<FetchLike> {
  return async () => ({
    ok: true, status: 200,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close() } })
  })
}

describe('engine paths + version pin', () => {
  it('ENGINE_NLC_VERSION matches the installed node-llama-cpp (binaries are ABI-locked to it)', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/node-llama-cpp/package.json'), 'utf8'))
    expect(ENGINE_NLC_VERSION).toBe(pkg.version)
  })
  it('compose the versioned userData paths + tarball url', () => {
    expect(engineRootFor('/data')).toBe(join('/data', 'ai-engine', ENGINE_NLC_VERSION))
    expect(engineBinsDir('/data')).toBe(join('/data', 'ai-engine', ENGINE_NLC_VERSION, ENGINE_VARIANT))
    expect(engineTarballUrl('owner/repo')).toBe(
      `https://github.com/owner/repo/releases/download/ai-engine-v${ENGINE_NLC_VERSION}/ai-engine-${ENGINE_VARIANT}.tar.gz`
    )
  })
})

describe('isEngineInstalledAt', () => {
  it('requires BOTH llama-addon.node and _nlcBuildMetadata.json', () => {
    const d = tmp()
    expect(isEngineInstalledAt(d)).toBe(false)
    writeFileSync(join(d, 'llama-addon.node'), 'x')
    expect(isEngineInstalledAt(d)).toBe(false)
    writeFileSync(join(d, '_nlcBuildMetadata.json'), '{}')
    expect(isEngineInstalledAt(d)).toBe(true)
  })
})

describe('downloadAndExtractEngine', () => {
  it('downloads, extracts, verifies, and reports progress', async () => {
    const src = tmp()
    writeFileSync(join(src, 'llama-addon.node'), 'ADDON')
    writeFileSync(join(src, '_nlcBuildMetadata.json'), '{"v":1}')
    writeFileSync(join(src, 'libggml-base.dylib'), 'DYLIB')
    const tarPath = join(tmp(), 'engine.tar.gz')
    execFileSync('tar', ['-czf', tarPath, '-C', src, '.'])
    const bytes = readFileSync(tarPath)

    const binsDir = join(tmp(), 'ai-engine', ENGINE_NLC_VERSION, ENGINE_VARIANT)
    const progress: number[] = []
    let doneSeen = false
    await downloadAndExtractEngine(binsDir, {
      url: 'https://x/engine.tar.gz',
      fetchFn: fakeFetch(bytes, { 'content-length': String(bytes.length) }),
      onProgress: (p) => { if (p.receivedBytes) progress.push(p.receivedBytes); if (p.done) doneSeen = true }
    })
    expect(isEngineInstalledAt(binsDir)).toBe(true)
    expect(existsSync(join(binsDir, 'libggml-base.dylib'))).toBe(true)
    expect(progress.at(-1)).toBe(bytes.length)
    expect(doneSeen).toBe(true)
  })

  it('rejects an archive missing the required files', async () => {
    const src = tmp()
    writeFileSync(join(src, 'random.txt'), 'nope')
    const tarPath = join(tmp(), 'bad.tar.gz')
    execFileSync('tar', ['-czf', tarPath, '-C', src, '.'])
    await expect(
      downloadAndExtractEngine(join(tmp(), 'bins'), { url: 'x', fetchFn: fakeFetch(readFileSync(tarPath)) })
    ).rejects.toThrow(/incomplete|invalid/i)
  })

  it('rejects a non-ok response', async () => {
    const fetchFn = async (): Promise<FetchLike> => ({ ok: false, status: 404, headers: { get: () => null }, body: null })
    await expect(downloadAndExtractEngine(join(tmp(), 'bins'), { url: 'x', fetchFn })).rejects.toThrow(/HTTP 404/)
  })
})
