import { readdirSync, statSync, unlinkSync } from 'fs'
import { join, basename, extname } from 'path'
import type { LocalModel } from '../../shared/domain'

export function listLocalModels(modelsDir: string): LocalModel[] {
  let entries: string[] = []
  try { entries = readdirSync(modelsDir) } catch { return [] }
  return entries
    .filter((f) => f.endsWith('.gguf'))
    .map((f) => {
      const path = join(modelsDir, f)
      return { id: f, name: basename(f, extname(f)), path, sizeBytes: statSync(path).size }
    })
}

/** id is a bare filename; reject anything that would escape modelsDir. */
export function deleteLocalModel(modelsDir: string, id: string): void {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) throw new Error(`Invalid model id: ${id}`)
  unlinkSync(join(modelsDir, id))
}

/** Download a catalog/URI model into modelsDir, reporting progress. Uses
 *  node-llama-cpp's downloader (dynamic import — ESM-only, see the Task 1 spike).
 *  Returns the downloaded file path. onProgress fields confirmed in the spike. */
export async function downloadModel(
  modelsDir: string,
  uri: string,
  onProgress: (receivedBytes: number, totalBytes: number) => void
): Promise<string> {
  const { createModelDownloader } = await import('node-llama-cpp')
  const downloader = await createModelDownloader({
    modelUri: uri,
    dirPath: modelsDir,
    onProgress: ({ downloadedSize, totalSize }) => onProgress(downloadedSize, totalSize)
  })
  return downloader.download()
}
