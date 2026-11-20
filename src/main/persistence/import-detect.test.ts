import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { detectImports, type DetectEnv, type DetectFs } from './import-detect'

/** An in-memory file tree: path → contents. Directories are implied by the paths. */
function fakeFs(files: Record<string, string>): DetectFs {
  const paths = Object.keys(files)
  return {
    readdir: (dir) => [...new Set(paths.filter((p) => p.startsWith(dir + '/')).map((p) => p.slice(dir.length + 1).split('/')[0]))],
    readFile: (path) => (path in files ? Buffer.from(files[path], 'utf8') : null)
  }
}

const mac: DetectEnv = { platform: 'darwin', home: '/Users/me' }
const dbeaverFile = (names: string[]): string => JSON.stringify({
  connections: Object.fromEntries(names.map((n, i) => [`id-${i}`, { provider: 'mysql', driver: 'mysql8', name: n, configuration: { host: 'db.example', port: '3306', database: 'app' } }]))
})
const compassFile = (name: string, uri: string, secrets = false): string => JSON.stringify({
  _id: name, version: 1, connectionInfo: { id: name, favorite: { name }, connectionOptions: { connectionString: uri } },
  ...(secrets ? { connectionSecrets: 'AAAA' } : {})
})

describe('detectImports', () => {
  it('finds nothing on a machine with neither tool', () => {
    expect(detectImports(mac, fakeFs({}))).toEqual([])
  })

  it('finds a DBeaver project on macOS', () => {
    const fs = fakeFs({ '/Users/me/Library/DBeaverData/workspace6/General/.dbeaver/data-sources.json': dbeaverFile(['a', 'b']) })
    const found = detectImports(mac, fs)
    expect(found.map((f) => [f.id, f.label, f.plan.source, f.plan.connections.length])).toEqual([['dbeaver:workspace6/General', 'DBeaver', 'dbeaver', 2]])
  })

  it('lists each DBeaver project by name when there are several, and skips empty ones', () => {
    const root = '/Users/me/Library/DBeaverData/workspace6'
    const fs = fakeFs({
      [`${root}/General/.dbeaver/data-sources.json`]: dbeaverFile(['a']),
      [`${root}/Work/.dbeaver/data-sources.json`]: dbeaverFile(['b', 'c']),
      [`${root}/Empty/.dbeaver/data-sources.json`]: dbeaverFile([]),
      [`${root}/.metadata/x.json`]: '{}'
    })
    expect(detectImports(mac, fs).map((f) => f.label)).toEqual(['DBeaver — General', 'DBeaver — Work'])
  })

  it('ignores a DBeaver file that is not JSON', () => {
    const fs = fakeFs({ '/Users/me/Library/DBeaverData/workspace6/General/.dbeaver/data-sources.json': 'not json' })
    expect(detectImports(mac, fs)).toEqual([])
  })

  it('reads Compass saved connections', () => {
    const dir = '/Users/me/Library/Application Support/MongoDB Compass/Connections'
    const fs = fakeFs({
      [`${dir}/one.json`]: compassFile('one', 'mongodb://user@10.0.0.1:27017/app', true),
      [`${dir}/two.json`]: compassFile('two', 'mongodb+srv://cluster.example/app'),
      [`${dir}/broken.json`]: '{'
    })
    const [found] = detectImports(mac, fs)
    expect(found.label).toBe('MongoDB Compass')
    expect(found.plan.connections.map((c) => [c.name, c.host, c.username])).toEqual([['one', '10.0.0.1', 'user']])
    // macOS: the passwords can be asked for through the keychain, so there is no notice.
    expect(found.plan.secrets.kind).toBe('keychain')
    expect(found.plan.skipped.map((s) => s.name)).toEqual(['two'])
    expect(found.plan.notes).toEqual([])
  })

  it('leaves Compass passwords behind off macOS, and says so', () => {
    const fs = fakeFs({ '/home/me/.config/MongoDB Compass/Connections/one.json': compassFile('one', 'mongodb://user@10.0.0.1/app', true) })
    const [found] = detectImports({ platform: 'linux', home: '/home/me' }, fs)
    expect(found.plan.secrets.kind).toBe('none')
    expect(found.plan.notes.join(' ')).toMatch(/keychain/)
  })

  it('uses the Windows and Linux locations', () => {
    const win: DetectEnv = { platform: 'win32', home: 'C:/Users/me', appData: '/appdata' }
    expect(detectImports(win, fakeFs({ [join('/appdata', 'DBeaverData/workspace6/General/.dbeaver/data-sources.json')]: dbeaverFile(['a']) }))).toHaveLength(1)
    const linux: DetectEnv = { platform: 'linux', home: '/home/me' }
    const fs = fakeFs({
      '/home/me/.local/share/DBeaverData/workspace6/General/.dbeaver/data-sources.json': dbeaverFile(['a']),
      '/home/me/.config/MongoDB Compass/Connections/one.json': compassFile('one', 'mongodb://localhost/app')
    })
    expect(detectImports(linux, fs).map((f) => f.id)).toEqual(['dbeaver:workspace6/General', 'compass'])
  })
})
