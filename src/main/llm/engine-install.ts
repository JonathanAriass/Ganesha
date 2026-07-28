// On-demand install of the native LLM engine binaries (the ~5 MB set no longer bundled in the app).
// Downloaded into a writable userData dir; the patched node-llama-cpp reads that dir from
// GANESHA_LLAMA_BINS_DIR (set by EngineHost). Pure core takes explicit paths so it's testable
// without Electron; thin Electron wrappers live in ipc.ts.
import { join, dirname } from 'path'
import { existsSync, mkdirSync, createWriteStream, rmSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'

const execFileP = promisify(execFile)

/** MUST match the node-llama-cpp version in package.json — the downloaded binaries are version-locked
 *  to it (N-API ABI + node-llama-cpp's packageVersion check). `engine-install.test.ts` enforces
 *  equality with the installed package; bump both together when upgrading node-llama-cpp. */
export const ENGINE_NLC_VERSION = '3.18.1'

/** The only supported variant for now (macOS arm64 + Metal). node-llama-cpp appends this to the
 *  bins dir, so the downloaded files live in `<engineRoot>/<variant>/`. */
export const ENGINE_VARIANT = 'mac-arm64-metal'

/** Where node-llama-cpp is pointed (GANESHA_LLAMA_BINS_DIR) — it looks in `<root>/<variant>/`. */
export function engineRootFor(dataDir: string): string {
  return join(dataDir, 'ai-engine', ENGINE_NLC_VERSION)
}

/** Directory the binaries are extracted into. */
export function engineBinsDir(dataDir: string): string {
  return join(engineRootFor(dataDir), ENGINE_VARIANT)
}

/** node-llama-cpp accepts a prebuilt dir only if BOTH the addon and its metadata are present. */
export function isEngineInstalledAt(binsDir: string): boolean {
  return existsSync(join(binsDir, 'llama-addon.node')) && existsSync(join(binsDir, '_nlcBuildMetadata.json'))
}

export interface EngineDownloadProgress {
  receivedBytes?: number
  totalBytes?: number
  done?: boolean
  error?: string
}

/** The subset of a fetch Response this needs (Electron `net.fetch` satisfies it). */
export interface FetchLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}

/**
 * Download the engine tarball, extract it into `binsDir`, and verify the required files landed.
 * Streams progress. Integrity rests on HTTPS + the post-extract file check (a corrupt/truncated
 * archive fails `tar` or the marker check); no reproducible-tarball checksum is pinned.
 */
export async function downloadAndExtractEngine(
  binsDir: string,
  opts: { url: string; fetchFn: (url: string) => Promise<FetchLike>; onProgress?: (p: EngineDownloadProgress) => void }
): Promise<void> {
  const res = await opts.fetchFn(opts.url)
  if (!res.ok || !res.body) throw new Error(`Engine download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || undefined

  mkdirSync(dirname(binsDir), { recursive: true })
  const tmp = `${binsDir}.download.tar.gz`
  let received = 0
  const out = createWriteStream(tmp)
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  try {
    await new Promise<void>((resolve, reject) => {
      nodeStream.on('data', (c: Buffer) => {
        received += c.length
        opts.onProgress?.({ receivedBytes: received, totalBytes: total })
      })
      nodeStream.on('error', reject)
      out.on('error', reject)
      out.on('finish', () => resolve())
      nodeStream.pipe(out)
    })

    // Fresh extract into the variant dir (atomic-ish: the dir is rebuilt from scratch).
    rmSync(binsDir, { recursive: true, force: true })
    mkdirSync(binsDir, { recursive: true })
    await execFileP('tar', ['-xzf', tmp, '-C', binsDir])
    if (!isEngineInstalledAt(binsDir)) throw new Error('Engine archive was incomplete or invalid.')
    opts.onProgress?.({ done: true })
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Release asset URL for the platform-matched engine of the pinned node-llama-cpp version.
 *  The `ai-engine-v<version>` release is produced by CI (Phase 4) and holds one tarball per variant. */
export function engineTarballUrl(repo = 'JonathanAriass/Ganesha'): string {
  return `https://github.com/${repo}/releases/download/ai-engine-v${ENGINE_NLC_VERSION}/ai-engine-${ENGINE_VARIANT}.tar.gz`
}
