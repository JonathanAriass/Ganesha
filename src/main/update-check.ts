/** Parse "1.2.3" (optionally "v1.2.3"; ignores any -prerelease/+build suffix) → [major, minor, patch]. */
export function parseVersion(v: string): [number, number, number] {
  const core = v.replace(/^v/i, '').split(/[-+]/)[0]
  const parts = core.split('.').map((n) => parseInt(n, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

/** True when `latest` is strictly newer than `current` — compared major, then minor, then patch. */
export function isNewerVersion(latest: string, current: string): boolean {
  const l = parseVersion(latest)
  const c = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i]
  }
  return false
}

export interface AvailableUpdate {
  version: string
  url: string
}

/**
 * Ask GitHub for the repo's latest release and return it when it's newer than `currentVersion`. Any
 * failure (offline, rate-limited, malformed, or up-to-date) resolves to null so the caller simply
 * doesn't notify. `fetchJson` is injected so this is unit-testable without the network.
 */
export async function checkForUpdate(
  currentVersion: string,
  repo: string,
  fetchJson: (url: string) => Promise<{ tag_name?: string; html_url?: string }>,
): Promise<AvailableUpdate | null> {
  try {
    const data = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`)
    if (!data.tag_name) return null
    const version = data.tag_name.replace(/^v/i, '')
    if (!isNewerVersion(version, currentVersion)) return null
    return { version, url: data.html_url ?? `https://github.com/${repo}/releases/latest` }
  } catch {
    return null
  }
}
