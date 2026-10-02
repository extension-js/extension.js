import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// A registry a spec can PROVE governed an install. An environment override
// alone cannot be proven: a lane that drops the variable resolves the real
// registry and the spec still reads as offline. This server's request log is
// the evidence, and the pin below goes out through two channels.
export interface OfflineRegistryFixture {
  url: string
  requests(): string[]
  close(): Promise<void>
}

// Its own process, same reason as the catalog fixture: a caller that drives a
// package manager with spawnSync blocks its event loop and a server living
// there never accepts the manager's connection.
const SERVER_SOURCE = `
const fs = require('node:fs')
const http = require('node:http')
const log = process.argv[1]
const server = http.createServer((request, response) => {
  fs.appendFileSync(log, (request.url || '') + '\\n')
  response.writeHead(404, {'content-type': 'application/json'})
  response.end('{"error":"not published to the offline spec registry"}')
})
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n')
})
`

export async function serveOfflineRegistry(): Promise<OfflineRegistryFixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-offline-registry-'))
  const logPath = path.join(dir, 'requests.log')
  fs.writeFileSync(logPath, '')

  const child = spawn(process.execPath, ['-e', SERVER_SOURCE, logPath], {
    stdio: ['ignore', 'pipe', 'inherit']
  })

  const close = async () => {
    child.kill()
    fs.rmSync(dir, {recursive: true, force: true})
  }

  const port = await new Promise<string>((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => {
      reject(new Error('the offline registry fixture never reported a port'))
    }, 20_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      out += chunk
      const [line] = out.split('\n')

      if (out.includes('\n') && line.trim()) {
        clearTimeout(timer)
        resolve(line.trim())
      }
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  }).catch(async (error) => {
    await close()

    throw error
  })

  const requests = () => {
    try {
      return fs
        .readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
    } catch {
      return []
    }
  }

  return {url: `http://127.0.0.1:${port}/`, requests, close}
}

// Project-level config every manager this repo scaffolds for reads: npm, pnpm
// and bun from .npmrc, Yarn Berry from .yarnrc.yml. No retry-timeout key, pnpm
// validates it against its own default minimum and refuses the pair, and no
// release-age key, npm warns about it and the warning would then travel in the
// install's own failure text.
export function offlineRegistryFiles(url: string): Record<string, string> {
  return {
    '.npmrc': [
      `registry=${url}`,
      'fetch-retries=0',
      'audit=false',
      'fund=false',
      'progress=false',
      ''
    ].join('\n'),
    '.yarnrc.yml': `npmRegistryServer: "${url}"\n`
  }
}

// `pnpm run` exports its whole effective config, so every gate starts with
// npm_config_registry pointing at npmjs.org, and an environment registry
// outranks the project file. The inherited value has to be DISPLACED, not just
// countered, and the request log is what proves one of the two pins held.
export function offlineRegistryEnv(url: string): Record<string, string> {
  return {npm_config_registry: url}
}
