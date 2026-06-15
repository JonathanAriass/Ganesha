import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Network, type StartedTestContainer, type StartedNetwork } from 'testcontainers'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SshTunnelManager } from './tunnel-manager'
import type { ResolvedHop } from './auth'

// Minimal Alpine sshd: OpenSSH defaults to AllowTcpForwarding yes (the linuxserver
// image disables it, which silently breaks forwardOut). Password auth, user tester.
// Alpine's sshd_config bakes in `AllowTcpForwarding no`; first value wins so an
// appended override is ignored. A command-line -o is processed first and wins.
const DOCKERFILE = `FROM alpine:3.19
RUN apk add --no-cache openssh \\
 && ssh-keygen -A \\
 && adduser -D tester \\
 && echo 'tester:tpw' | chpasswd
EXPOSE 22
CMD ["/usr/sbin/sshd","-D","-e","-o","AllowTcpForwarding=yes"]
`

describe('SSH tunnel (integration, requires Docker)', () => {
  let network: StartedNetwork
  let pg: StartedPostgreSqlContainer
  let sshd: StartedTestContainer
  let mgr: SshTunnelManager

  beforeAll(async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'sshd-ctx-'))
    writeFileSync(join(ctx, 'Dockerfile'), DOCKERFILE)

    network = await new Network().start()
    pg = await new PostgreSqlContainer('postgres:16-alpine')
      .withNetwork(network).withNetworkAliases('pgdb')
      .withDatabase('test').withUsername('test').withPassword('test')
      .start()
    const sshImage = await GenericContainer.fromDockerfile(ctx).build()
    sshd = await sshImage.withNetwork(network).withExposedPorts(22).start()
    mgr = new SshTunnelManager()
  }, 240_000)

  afterAll(async () => {
    await mgr?.closeAll()
    await sshd?.stop()
    await pg?.stop()
    await network?.stop()
  })

  it('forwards a pg connection through the sshd to the database', async () => {
    const hop: ResolvedHop = {
      host: sshd.getHost(), port: sshd.getMappedPort(22),
      username: 'tester', auth: 'password', password: 'tpw'
    }
    // From inside the docker network the DB is reachable as pgdb:5432.
    const ep = await mgr.open('it1', [hop], 'pgdb', 5432)
    const client = new Client({ host: ep.host, port: ep.port, user: 'test', password: 'test', database: 'test' })
    await client.connect()
    const r = await client.query('SELECT 1 AS n')
    expect(r.rows[0].n).toBe(1)
    await client.end()
  }, 60_000)
})
