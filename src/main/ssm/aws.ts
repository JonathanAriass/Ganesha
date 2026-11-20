import { execFile, execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { AwsInstance } from '../../shared/domain'

let cachedPath: string | null = null

/** A macOS GUI app doesn't inherit the shell PATH, so `aws` (homebrew/pyenv/…) wouldn't resolve.
 *  Resolve the user's real PATH once via a login+interactive shell; markers skip any startup noise. */
export function resolveUserPath(): string {
  if (cachedPath != null) return cachedPath
  const fallback = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:${homedir()}/.local/bin`
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-ilc', 'printf "__P__%s__E__" "$PATH"'], { encoding: 'utf8', timeout: 4000 })
    const m = out.match(/__P__(.*)__E__/s)
    cachedPath = m && m[1] ? m[1] : fallback
  } catch {
    cachedPath = fallback
  }
  return cachedPath
}

/** Run a one-shot `aws` command with the resolved PATH; resolve stdout, reject with stderr on failure. */
export function runAws(args: string[], timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'aws',
      args,
      { env: { ...process.env, PATH: resolveUserPath() }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || '').trim() || err.message))
        else resolve(stdout)
      }
    )
  })
}

/** Pure: profile names from ~/.aws/config (`[profile X]`, `[default]`) + ~/.aws/credentials (`[X]`).
 *  `[sso-session …]` / other non-profile config sections are skipped. */
export function parseAwsProfiles(configText: string | null, credText: string | null): string[] {
  const names = new Set<string>()
  const scan = (text: string | null, isConfig: boolean): void => {
    if (!text) return
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*\[([^\]]+)\]\s*$/)
      if (!m) continue
      let name = m[1].trim()
      if (isConfig) {
        if (name.startsWith('profile ')) name = name.slice('profile '.length).trim()
        else if (name !== 'default') continue
      }
      names.add(name)
    }
  }
  scan(configText, true)
  scan(credText, false)
  return [...names].sort()
}

export function listAwsProfiles(): string[] {
  const read = (f: string): string | null => {
    const p = join(homedir(), '.aws', f)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  return parseAwsProfiles(read('config'), read('credentials'))
}

/** The caller arn from `aws sts get-caller-identity --output json`. */
export function parseArn(json: string): string {
  return (JSON.parse(json) as { Arn?: string }).Arn ?? ''
}

/** SSM-managed instances from `aws ssm describe-instance-information --output json`. */
export function parseInstances(json: string): AwsInstance[] {
  const data = JSON.parse(json) as {
    InstanceInformationList?: { InstanceId: string; ComputerName?: string; PingStatus?: string }[]
  }
  return (data.InstanceInformationList ?? []).map((i) => ({
    instanceId: i.InstanceId,
    name: i.ComputerName || i.InstanceId,
    ping: i.PingStatus ?? ''
  }))
}

/** The `--query` for `aws ec2 describe-instances` that yields `[{ id, name }]` (name = `Name` tag). */
export const INSTANCE_NAMES_QUERY = 'Reservations[].Instances[].{id:InstanceId,name:Tags[?Key==`Name`]|[0].Value}'

/** Instance id → `Name` tag, from `aws ec2 describe-instances --query INSTANCE_NAMES_QUERY --output json`. */
export function parseInstanceNames(json: string): Record<string, string> {
  const rows = JSON.parse(json) as { id?: string; name?: string | null }[] | null
  const names: Record<string, string> = {}
  for (const r of rows ?? []) if (r.id && r.name && r.name.trim()) names[r.id] = r.name.trim()
  return names
}

/** Pure: put each instance's `Name` tag in front of its host name (kept as `host`, so both stay
 *  searchable), and sort by name. Instances with no tag keep what SSM reported. */
export function nameInstances(instances: AwsInstance[], names: Record<string, string>): AwsInstance[] {
  return instances
    .map((i) => {
      const tag = names[i.instanceId]
      return tag && tag !== i.name ? { ...i, name: tag, ...(i.name !== i.instanceId ? { host: i.name } : {}) } : i
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}
