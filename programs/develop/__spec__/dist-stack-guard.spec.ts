import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {beforeAll, describe, expect, it} from 'vitest'
import {RUST_MIN_STACK_BYTES} from '../lib/rust-min-stack'
import {staticGraphOf} from './helpers/dist-import-graph'

const DIST_DIR = path.resolve(__dirname, '..', 'dist')
const MODULE_ENTRY = path.join(DIST_DIR, 'module.mjs')

// The rspack binding sizes its threads while it loads. Setting the variable
// after that changes nothing, so the built entry is read, not the source.
describe('the stack guard in the built extension-develop entry', () => {
  beforeAll(() => {
    if (!fs.existsSync(MODULE_ENTRY)) {
      throw new Error(
        `${MODULE_ENTRY} does not exist. Run \`pnpm --filter extension-develop compile\` ` +
          'before vitest so this gate has a build to read.'
      )
    }
  })

  it('is still in module.mjs after the bundler dropped unused code', () => {
    const built = fs.readFileSync(MODULE_ENTRY, 'utf8')

    expect(
      built,
      'module.mjs no longer sets RUST_MIN_STACK. The package is marked ' +
        'side-effect free, so a guard that is only imported is removed.'
    ).toMatch(/env\.RUST_MIN_STACK\s*=/)

    expect(built).toContain(String(RUST_MIN_STACK_BYTES))
  })

  it('runs before any file that loads @rspack/core', () => {
    const built = fs.readFileSync(MODULE_ENTRY, 'utf8')
    const graph = staticGraphOf(MODULE_ENTRY)

    expect(
      graph.packages.get('@rspack/core'),
      'module.mjs reaches @rspack/core through static imports, which run ' +
        'before the body of module.mjs, so the guard would run too late.'
    ).toBeUndefined()

    const guardCall = built.search(/^ensureRustMinStack\(\);/m)
    const firstLoad = built.indexOf('import(')

    expect(guardCall).toBeGreaterThan(-1)
    expect(firstLoad).toBeGreaterThan(guardCall)
  })

  it('sets the variable in a process that imports the built entry', () => {
    const script =
      `await import(${JSON.stringify(pathToFileURL(MODULE_ENTRY).href)});` +
      'process.stdout.write(String(process.env.RUST_MIN_STACK))'

    const run = (preset?: string) => {
      const env: NodeJS.ProcessEnv = {...process.env}
      delete env.RUST_MIN_STACK

      if (preset) env.RUST_MIN_STACK = preset

      return spawnSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        {encoding: 'utf8', env}
      )
    }

    const unset = run()
    expect(unset.status, unset.stderr).toBe(0)
    expect(unset.stdout).toBe(String(RUST_MIN_STACK_BYTES))

    const preset = run('8388608')
    expect(preset.status, preset.stderr).toBe(0)
    expect(preset.stdout).toBe('8388608')
  }, 60_000)
})
