/** Filesystem side of repo retrieval: a bounded directory walk and a guarded file read. Kept apart
 *  from repo-context.ts (pure matching/ranking) so the latter stays unit-testable without disk. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Directories never worth scanning — dependencies, VCS, and build output. Dot-directories are
 *  skipped separately. */
const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'coverage',
  '__pycache__'
])

/** Extensions that hold no readable source — images, media, archives, fonts, compiled blobs. */
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tar|tgz|rar|7z|jar|war|class|exe|dll|so|dylib|o|a|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|mkv|webm|wav|ogg|flac|bin|dat|db|sqlite3?|lock)$/i

const MAX_FILES = 4000
const MAX_FILE_BYTES = 256 * 1024

/** Walk `repoPath` breadth-first, returning repo-relative, forward-slashed paths of plausibly-source
 *  files. Bounded by MAX_FILES and per-file size; skips dependency/build/dot directories and binaries.
 *  Never throws — an unreadable directory is simply skipped (returns what it has so far). */
export function scanRepoFiles(repoPath: string): string[] {
  const root = resolve(repoPath)
  const out: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && out.length < MAX_FILES) {
    const dir = queue.shift()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // unreadable dir (perms, race) — skip it
    }
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.')) continue // .git, .env*, dotfiles
      const full = join(dir, name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(name)) queue.push(full)
        continue
      }
      if (!entry.isFile()) continue // symlinks, sockets, etc.
      if (BINARY_EXT.test(name)) continue
      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue
      } catch {
        continue
      }
      out.push(relative(root, full).split(sep).join('/'))
      if (out.length >= MAX_FILES) break
    }
  }
  return out
}

/** Read one repo-relative file as UTF-8 text. Returns null if the path escapes the repo (traversal
 *  guard), the file is missing/too large, or it can't be decoded. */
export function readRepoFile(repoPath: string, relPath: string): string | null {
  const root = resolve(repoPath)
  const full = resolve(root, relPath)
  if (full !== root && !full.startsWith(root + sep)) return null // outside the repo
  try {
    if (statSync(full).size > MAX_FILE_BYTES) return null
    return readFileSync(full, 'utf8')
  } catch {
    return null
  }
}
