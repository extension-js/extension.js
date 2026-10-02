import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  fixtureExtensionFiles,
  serveExamplesCatalog
} from '../../../create/__spec__/examples-catalog-fixture'
import {
  offlineRegistryEnv,
  offlineRegistryFiles,
  serveOfflineRegistry
} from '../../../create/__spec__/offline-registry-fixture'

const ANSI = /\x1b\[[0-9;]*m/g

// A dependency no registry can satisfy, so the install fails on every lane
// whether or not the pin held. The request log is what proves the pin held.
const ABSENT_DEPENDENCY = '@extension-js-offline-proof/absent'

function cliBin(): string {
  const root = path.resolve(__dirname, '../..')
  const cjs = path.join(root, 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(root, 'dist', 'cli.js')
}

function runCreateIn(
  work: string,
  args: string[],
  env: Record<string, string>
): Promise<{status: number | null; stderr: string}> {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))

  return new Promise((resolve) => {
    let stderr = ''
    const child = spawn(process.execPath, [cliBin(), ...args], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        ...env,
        EXTENSION_ENV: 'test',
        EXTENSION_TELEMETRY: '0',
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome
      }
    })
    child.stderr.setEncoding('utf8')

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('close', (status) => {
      resolve({status, stderr: stderr.replace(ANSI, '')})
    })
  })
}

describe('an install pinned to a loopback registry stays off the network', () => {
  let status: number | null = null
  let stderr = ''
  let asked: string[] = []
  let engineInstalled = true

  let cleanup: () => Promise<void> = async () => {}

  beforeAll(async () => {
    const registry = await serveOfflineRegistry()
    const template = 'offline-install-proof'
    const catalog = await serveExamplesCatalog({
      [template]: {
        ...fixtureExtensionFiles(template),
        ...offlineRegistryFiles(registry.url),
        'package.json': `${JSON.stringify(
          {
            private: true,
            name: template,
            version: '1.0.0',
            type: 'module',
            dependencies: {[ABSENT_DEPENDENCY]: '^1.0.0'}
          },
          null,
          2
        )}\n`
      }
    })
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-offline-install-'))

    cleanup = async () => {
      await catalog.close()
      await registry.close()
      fs.rmSync(work, {recursive: true, force: true})
    }

    const result = await runCreateIn(
      work,
      ['create', './proof', '-t', template, '--install'],
      {
        ...offlineRegistryEnv(registry.url),
        EXTENSION_CREATE_TEMPLATE_URL: catalog.url,
        EXTENSION_ALLOW_HTTP_TEMPLATE: 'true'
      }
    )

    status = result.status
    stderr = result.stderr
    asked = registry
      .requests()
      .filter((url) => decodeURIComponent(url).includes(ABSENT_DEPENDENCY))

    engineInstalled = fs.existsSync(
      path.join(work, 'proof', 'node_modules', 'extension', 'package.json')
    )
  }, 180000)

  afterAll(async () => {
    await cleanup()
  })

  it('fails the install and brings back nothing', () => {
    expect(status).toBe(1)
    expect(engineInstalled).toBe(false)
    expect(stderr).not.toMatch(
      /NO_MATURE_MATCHING_VERSION|minimum[-_ ]?release[-_ ]?age/i
    )
  })

  it.skipIf(process.platform === 'win32')(
    'asks the pinned registry for the dependency, so the pin governed',
    () => {
      expect(asked.length).toBeGreaterThan(0)
    }
  )
})
