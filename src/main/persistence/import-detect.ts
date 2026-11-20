import { join } from 'path'
import type { ImportPlan } from './connection-transfer'
import { parseCompassStore, parseDbeaver, underImportGroup } from './import-sources'

/** Finds the connections other database tools keep on this machine (DBeaver, MongoDB Compass)
 *  so they can be offered for import without the user hunting for the files. Only reads; the
 *  environment and the file system are passed in so this runs the same under test. */

export interface DetectEnv {
  platform: NodeJS.Platform
  home: string
  /** %APPDATA% (Windows). */
  appData?: string
  xdgData?: string
  xdgConfig?: string
}

export interface DetectFs {
  /** Entry names of a directory; empty when it does not exist. */
  readdir(dir: string): string[]
  /** A file's bytes; null when it does not exist or cannot be read. */
  readFile(path: string): Buffer | null
}

export interface DetectedPlan {
  id: string
  label: string
  /** What the import dialog shows as the file. */
  fileName: string
  plan: ImportPlan
}

function json(buf: Buffer | null): unknown {
  if (!buf) return null
  try { return JSON.parse(buf.toString('utf8')) } catch { return null }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Where an app keeps per-user data: DBeaver uses the "data" location, Compass (Electron) the
 *  "config" one; they only differ on Linux. */
function userDir(env: DetectEnv, kind: 'data' | 'config'): string {
  if (env.platform === 'darwin') return join(env.home, 'Library', kind === 'data' ? '' : 'Application Support')
  if (env.platform === 'win32') return env.appData || join(env.home, 'AppData', 'Roaming')
  return kind === 'data' ? env.xdgData || join(env.home, '.local', 'share') : env.xdgConfig || join(env.home, '.config')
}

/** One entry per DBeaver project that has connections: any workspace folder, any project,
 *  its .dbeaver folder. */
function dbeaver(env: DetectEnv, fs: DetectFs): DetectedPlan[] {
  const root = join(userDir(env, 'data'), 'DBeaverData')
  const found: Array<{ key: string; project: string; plan: ImportPlan }> = []
  for (const ws of fs.readdir(root).filter((n) => n.startsWith('workspace')).sort()) {
    for (const project of fs.readdir(join(root, ws)).filter((n) => !n.startsWith('.')).sort()) {
      const dir = join(root, ws, project, '.dbeaver')
      const raw = json(fs.readFile(join(dir, 'data-sources.json')))
      if (!isObj(raw)) continue
      try {
        const plan = underImportGroup(parseDbeaver(raw, fs.readFile(join(dir, 'credentials-config.json'))))
        if (plan.connections.length > 0) found.push({ key: `${ws}/${project}`, project, plan })
      } catch { /* not a file this version understands: nothing to offer */ }
    }
  }
  return found.map((f) => ({
    id: `dbeaver:${f.key}`, label: found.length > 1 ? `DBeaver — ${f.project}` : 'DBeaver', fileName: 'data-sources.json', plan: f.plan
  }))
}

function compass(env: DetectEnv, fs: DetectFs): DetectedPlan[] {
  const dir = join(userDir(env, 'config'), 'MongoDB Compass', 'Connections')
  const entries = fs.readdir(dir).filter((n) => n.endsWith('.json')).sort().map((n) => json(fs.readFile(join(dir, n)))).filter(isObj)
  if (entries.length === 0) return []
  try {
    // Only macOS: elsewhere Compass protects its key in ways this cannot ask for.
    const plan = underImportGroup(parseCompassStore(entries, { keychain: env.platform === 'darwin' }))
    return plan.connections.length > 0 ? [{ id: 'compass', label: 'MongoDB Compass', fileName: 'Saved connections', plan }] : []
  } catch {
    return []
  }
}

export function detectImports(env: DetectEnv, fs: DetectFs): DetectedPlan[] {
  return [...dbeaver(env, fs), ...compass(env, fs)]
}
