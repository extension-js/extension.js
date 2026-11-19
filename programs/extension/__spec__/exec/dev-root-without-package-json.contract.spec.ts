import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {startCli} from '../helpers/run-cli'

// A project with src/manifest.json and no package.json: the session state
// belongs to the folder dev was pointed at, as it does with a package.json.
function createFixture(): string {
  const projectDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'extjs-dev-root-no-package-'))
  )

  mkdirSync(join(projectDir, 'src'))
  writeFileSync(
    join(projectDir, 'src', 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Dev Root Probe',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  writeFileSync(
    join(projectDir, 'src', 'background.js'),
    "console.log('dev root probe')\n"
  )

  return projectDir
}

function readReady(file: string): {status?: string; distPath?: string} {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

function waitForReady(file: string, output: () => string) {
  return new Promise<{status?: string; distPath?: string}>(
    (resolvePromise, reject) => {
      const startedAt = Date.now()

      const poll = () => {
        const ready = readReady(file)

        if (ready.status === 'ready') return resolvePromise(ready)

        if (Date.now() - startedAt > 90000) {
          return reject(new Error(`no ready.json, output:\n${output()}`))
        }

        setTimeout(poll, 50)
      }

      poll()
    }
  )
}

describe('dev --no-browser on src/manifest.json with no package.json', () => {
  it('keeps ready.json and the build under the folder it was pointed at', async () => {
    const projectDir = createFixture()
    const session = startCli([
      'dev',
      projectDir,
      '--no-browser',
      '--browser=chromium'
    ])
    const readyPath = join(
      projectDir,
      'dist',
      'extension-js',
      'chromium',
      'ready.json'
    )

    try {
      const ready = await waitForReady(readyPath, () => session.read().output)

      expect({
        distPath: ready.distPath,
        manifest: existsSync(
          join(projectDir, 'dist', 'chromium', 'manifest.json')
        ),
        source: readdirSync(join(projectDir, 'src')).sort()
      }).toEqual({
        distPath: join(projectDir, 'dist', 'chromium'),
        manifest: true,
        source: ['background.js', 'manifest.json']
      })
    } finally {
      await session.stop('SIGTERM')
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)
})
