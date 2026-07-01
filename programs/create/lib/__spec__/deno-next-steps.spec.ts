import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {isDenoRuntime} from '../package-manager'
import {successfullInstall} from '../messages'
import {writeReadmeFile} from '../../steps/write-readme-file'

// Simulate a Deno runtime by exposing its runtime global. Deno launches npm
// packages without `npm_config_user_agent`/`npm_execpath`, so the only reliable
// signal is `globalThis.Deno` (and `process.versions.deno`).
function withDenoGlobal(body: () => Promise<void> | void) {
  const hadDeno = 'Deno' in globalThis
  ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}
  return Promise.resolve(body()).finally(() => {
    if (!hadDeno) delete (globalThis as {Deno?: unknown}).Deno
  })
}

const noopLogger = {log() {}, error() {}}

describe('deno-aware scaffold next steps', () => {
  afterEach(() => {
    delete (globalThis as {Deno?: unknown}).Deno
  })

  it('detects the Deno runtime from its global', async () => {
    expect(isDenoRuntime()).toBe(false)
    await withDenoGlobal(() => {
      expect(isDenoRuntime()).toBe(true)
    })
  })

  it('suggests deno install / deno task dev in the next steps', async () => {
    await withDenoGlobal(async () => {
      const message = await successfullInstall('/tmp/my-ext', 'my-ext', false)
      expect(message).toContain('deno install')
      expect(message).toContain('deno task dev')
      expect(message).not.toContain('npm install')
      expect(message).not.toContain('npm run dev')
    })
  })

  it('writes deno task commands into the generated README', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ext-deno-readme-'))
    const projectPath = path.join(tmpRoot, 'my-ext')
    try {
      await fsp.mkdir(projectPath, {recursive: true})
      await fsp.writeFile(
        path.join(projectPath, 'manifest.json'),
        JSON.stringify({manifest_version: 3, description: 'deno readme'})
      )
      await withDenoGlobal(async () => {
        await writeReadmeFile(projectPath, 'my-ext', noopLogger)
      })
      const contents = await fsp.readFile(
        path.join(projectPath, 'README.md'),
        'utf8'
      )
      expect(contents).toContain('deno task dev')
      expect(contents).toContain('deno task dev --browser=firefox')
      expect(contents).toContain('deno task build:firefox')
      expect(contents).not.toContain('run dev')
      expect(contents).not.toContain('-- --browser')
    } finally {
      await fsp.rm(tmpRoot, {recursive: true, force: true})
    }
  })
})
