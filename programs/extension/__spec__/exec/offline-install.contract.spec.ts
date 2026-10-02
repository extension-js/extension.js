import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
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
  it('resolves the engine against the pin and brings back nothing', async () => {
    const registry = await serveOfflineRegistry()
    const template = 'offline-install-proof'
    const catalog = await serveExamplesCatalog({
      [template]: {
        ...fixtureExtensionFiles(template),
        ...offlineRegistryFiles(registry.url)
      }
    })
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-offline-install-'))
    const projectPath = path.join(work, 'proof')

    try {
      const result = await runCreateIn(
        work,
        ['create', './proof', '-t', template, '--install'],
        {
          ...offlineRegistryEnv(registry.url),
          EXTENSION_CREATE_TEMPLATE_URL: catalog.url,
          EXTENSION_ALLOW_HTTP_TEMPLATE: 'true'
        }
      )

      const asked = registry
        .requests()
        .filter((url) => /^\/extension(?:$|[/?])/.test(url))

      expect(asked.length).toBeGreaterThan(0)
      expect(result.status).toBe(1)
      expect(result.stderr.match(/⏵⏵⏵/g)).toHaveLength(1)
      expect(result.stderr).not.toMatch(
        /NO_MATURE_MATCHING_VERSION|minimum[-_ ]?release[-_ ]?age/i
      )

      const installed = path.join(
        projectPath,
        'node_modules',
        'extension',
        'package.json'
      )
      expect(fs.existsSync(installed)).toBe(false)
    } finally {
      await catalog.close()
      await registry.close()
      fs.rmSync(work, {recursive: true, force: true})
    }
  }, 180000)
})
