import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, describe, expect, it} from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const CLI_DIST = path.join(
  REPO_ROOT,
  'programs',
  'extension',
  'dist',
  'cli.cjs'
)
const TYPELESS_WARNING = 'MODULE_TYPELESS_PACKAGE_JSON'

const roots: string[] = []

function ensureCliBuilt(): boolean {
  if (fs.existsSync(CLI_DIST)) return true

  const result = spawnSync(
    'pnpm',
    ['-C', 'programs/extension', 'run', 'compile'],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    }
  )

  return result.status === 0 && fs.existsSync(CLI_DIST)
}

// A package.json without "type" and an ESM config that reads import.meta.env:
// the shape every example project ships with.
function scaffold() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-typeless-config-'))
  )
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({name: 'typeless-config', private: true}),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'typeless-config',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    '.env': 'EXTENSION_PUBLIC_NAME=from-env\n',
    'background.js': 'console.log("bg", process.env.CFG_NAME)\n',
    'extension.config.js': [
      "const name = import.meta.env.EXTENSION_PUBLIC_NAME || 'unset'",
      'export default {',
      "  define: {'process.env.CFG_NAME': name}",
      '}',
      ''
    ].join('\n')
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('loading an ESM extension.config.js from a typeless package', () => {
  it('prints no MODULE_TYPELESS_PACKAGE_JSON warning on a build', () => {
    expect(ensureCliBuilt()).toBe(true)

    const root = scaffold()
    const result = spawnSync(
      process.execPath,
      [CLI_DIST, 'build', root, '--browser=chromium'],
      {
        cwd: root,
        encoding: 'utf-8',
        timeout: 120_000,
        env: {
          ...process.env,
          EXTENSION_TELEMETRY_DISABLED: '1',
          CI: '1',
          NO_COLOR: '1'
        }
      }
    )

    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain(TYPELESS_WARNING)

    // The config did load through the import.meta.env path: its value
    // reached the bundle.
    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chromium', 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(worker).toContain('from-env')
  })

  it('control: Node itself warns when the same file is imported bare', () => {
    const root = scaffold()
    const configUrl = pathToFileURL(path.join(root, 'extension.config.js')).href
    // Bare Node has no import.meta.env, so the config throws after loading.
    // The warning is what matters and it is emitted before evaluation, but
    // only flushes when the process does not die on that error.
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `try { await import(${JSON.stringify(configUrl)}) } catch {}`
      ],
      {cwd: root, encoding: 'utf-8', timeout: 60_000}
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toContain(TYPELESS_WARNING)
  })
})
