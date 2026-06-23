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
