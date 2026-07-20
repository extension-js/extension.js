import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'
import {getEnvFileCandidates} from '../plugin-compilation/env'

const ROOTS: string[] = []

function makeFixture(envFiles: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-env-'))
  ROOTS.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {private: true, name: 'extjs-build-env-spec', version: '0.0.0'},
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, env injection',
        version: '1.0.0',
        background: {service_worker: 'sw.js'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(root, 'sw.js'),
    [
      'console.log("known:", import.meta.env.EXTENSION_PUBLIC_KNOWN)',
      'console.log("missing:", import.meta.env.EXTENSION_PUBLIC_MISSING)',
      ''
    ].join('\n')
  )

  for (const [name, content] of Object.entries(envFiles)) {
    fs.writeFileSync(path.join(root, name), content)
  }

  return root
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(root, {
      browser: 'chromium',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

function runWorker(root: string): string[] {
  const workerPath = path.join(
    root,
    'dist',
    'chromium',
    'background',
    'service_worker.js'
  )
  expect(fs.existsSync(workerPath), `missing ${workerPath}`).toBe(true)

  const logs: string[] = []
  const context = vm.createContext({
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' '))
    }
  })
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context, {
    filename: 'background/service_worker.js'
  })
  return logs
}

afterAll(() => {
  for (const root of ROOTS) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('build: .env injection (real rspack)', () => {
  it('resolves .env.chrome family-wide for a chromium build and never crashes on undefined vars', async () => {
    const root = makeFixture({
      '.env.chrome': 'EXTENSION_PUBLIC_KNOWN="from-env-chrome"\n'
    })
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(0)

    const logs = runWorker(root)
    expect(logs).toContain('known: from-env-chrome')
    expect(logs).toContain('missing: undefined')
  }, 120_000)

  it('yields undefined (not a boot crash) when no env file exists at all', async () => {
    const root = makeFixture({})
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(0)

    const logs = runWorker(root)
    expect(logs).toContain('known: undefined')
    expect(logs).toContain('missing: undefined')
  }, 120_000)

  it('warns when the shipped .env files match no candidate for the target browser', async () => {
    const root = makeFixture({
      '.env.firefox': 'EXTENSION_PUBLIC_KNOWN="firefox-only"\n'
    })
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBeGreaterThan(0)

    const logs = runWorker(root)
    expect(logs).toContain('known: undefined')
  }, 120_000)
})

describe('getEnvFileCandidates', () => {
  it('mirrors the manifest-prefix family contract', () => {
    const chromium = getEnvFileCandidates('chromium' as any, 'production')
    expect(chromium.indexOf('.env.chromium')).toBeLessThan(
      chromium.indexOf('.env.chrome')
    )
    expect(chromium).toContain('.env.chrome')
    expect(chromium).toContain('.env.edge')
    expect(chromium).toContain('.env.chromium-based')
    expect(chromium[chromium.length - 1]).toBe('.env')

    const firefox = getEnvFileCandidates('firefox' as any, 'development')
    expect(firefox).toContain('.env.firefox.development')
    expect(firefox).toContain('.env.gecko-based')
    expect(firefox).not.toContain('.env.chrome')

    expect(getEnvFileCandidates('safari' as any, 'production')).toContain(
      '.env.chrome'
    )
  })
})
