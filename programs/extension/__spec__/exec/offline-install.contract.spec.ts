import fs from 'node:fs'
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
import {cliEnv, freshCliHome, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

// A dependency no registry can satisfy, so the install fails on every lane
// whether or not the pin held. The request log is what proves the pin held.
const ABSENT_DEPENDENCY = '@extension-js-offline-proof/absent'
const PACKAGE_MANAGER_REQUEST = /^\/(?:pnpm|yarn|@yarnpkg\/cli-dist)(?:\/|$)/
const REGISTRY_VARIABLE = /^(?:npm_config_registry|corepack_npm_registry)$/i

// The helper's env inherits no registry, and the package manager keeps its
// cache and store in the run's own temp home.
async function runCreateIn(
  work: string,
  args: string[],
  env: Record<string, string>
) {
  const options = {home: freshCliHome(), env}
  const handed = Object.entries(cliEnv(options))
    .filter(([key]) => REGISTRY_VARIABLE.test(key))
    .map(([key, value]) => `${key}=${value}`)
  const run = await runCli(args, {cwd: work, timeoutMs: 170_000, ...options})

  return {status: run.status, stderr: run.stderr, handed}
}

describe('an install pinned to a loopback registry stays off the network', () => {
  let status: number | null = null
  let stderr = ''
  let asked: string[] = []
  let evidence = ''
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
    const work = makeTempFolder('extjs-offline-install-')

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
    const requests = registry.requests()
    asked = requests.filter((url) => {
      const decoded = decodeURIComponent(url)

      return (
        decoded.includes(ABSENT_DEPENDENCY) ||
        PACKAGE_MANAGER_REQUEST.test(decoded)
      )
    })

    evidence = [
      `the loopback registry saw: ${requests.join(' ') || 'nothing'}`,
      `registry variables handed to the CLI: ${result.handed.join(' ')}`,
      `the install said: ${stderr.trim()}`
    ].join('\n')

    engineInstalled = fs.existsSync(
      path.join(work, 'proof', 'node_modules', 'extension', 'package.json')
    )
  }, 180000)

  afterAll(async () => {
    await cleanup()
  })

  it('fails the install and brings back nothing', () => {
    expect(status, evidence).toBe(1)
    expect(engineInstalled).toBe(false)
    expect(stderr).not.toMatch(
      /NO_MATURE_MATCHING_VERSION|minimum[-_ ]?release[-_ ]?age/i
    )
  })

  it('asks the pinned registry for the dependency or for the package manager, so the pin governed', () => {
    expect(asked.length, evidence).toBeGreaterThan(0)
  })
})
