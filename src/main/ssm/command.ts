import type { SsmTunnel } from '../../shared/domain'

/** The `aws` argv for an SSM port-forwarding session. `--parameters` is a single JSON argv element, so
 *  spawning `aws` directly (no shell) needs no escaping. Pure — unit-tested. */
export function buildSsmArgs(t: Pick<SsmTunnel, 'profile' | 'region' | 'instanceId' | 'remotePort' | 'localPort'>): string[] {
  return [
    'ssm',
    'start-session',
    '--profile', t.profile,
    '--region', t.region,
    '--target', t.instanceId,
    '--document-name', 'AWS-StartPortForwardingSession',
    '--parameters',
    JSON.stringify({ portNumber: [String(t.remotePort)], localPortNumber: [String(t.localPort)] })
  ]
}
