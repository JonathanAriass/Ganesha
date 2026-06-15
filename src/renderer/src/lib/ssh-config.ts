import type { SshConfig, SshHop } from '@shared/domain'

export function emptyHop(id: string): SshHop {
  return { id, host: '', port: 22, username: '', auth: 'key', keyPath: '' }
}

export function normalizeSshConfig(ssh: SshConfig | null): SshConfig | null {
  if (ssh === null) return null
  return {
    enabled: ssh.enabled,
    hops: ssh.hops.map((h) => ({
      id: h.id,
      host: h.host.trim(),
      port: Number.isInteger(h.port) && h.port >= 1 && h.port <= 65535 ? h.port : 22,
      username: h.username.trim(),
      auth: h.auth,
      keyPath: h.keyPath.trim()
    }))
  }
}

/** Structural validation only — secret presence is resolved in main (stored
 *  secrets aren't visible to the renderer, so we can't require them here). */
export function validateSshConfig(ssh: SshConfig | null): string | null {
  if (ssh === null || !ssh.enabled) return null
  if (ssh.hops.length === 0) return 'Enable SSH tunnel: add at least one hop.'
  for (let i = 0; i < ssh.hops.length; i++) {
    const h = ssh.hops[i]
    const where = `hop ${i + 1}`
    if (!h.host.trim()) return `SSH ${where}: host is required.`
    if (!h.username.trim()) return `SSH ${where}: username is required.`
    if (!Number.isInteger(h.port) || h.port < 1 || h.port > 65535) return `SSH ${where}: port must be 1–65535.`
    if (h.auth === 'key' && !h.keyPath.trim()) return `SSH ${where}: a key file is required for key auth.`
  }
  return null
}
