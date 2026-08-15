/* @ts-nocheck */
import * as fs from 'node:fs'
import * as path from 'node:path'
import glob from 'tiny-glob'

// The suites assert on exact human-readable output. A caller's FORCE_COLOR
// wraps that output in ANSI and breaks the assertions, so color is forced
// off before any message module loads: monochrome is the test contract.
// Spawned CLI children inherit this environment too.
process.env.FORCE_COLOR = '0'
process.env.NO_COLOR = '1'

// Same contract for verbosity: author-mode envs add debug lines that break
// exact-output assertions. Specs that test debug behavior set these
// themselves per-test; the suite baseline is the default tier.
Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')

async function rm(dir: string) {
  try {
    fs.rmSync(dir, {recursive: true, force: true})
  } catch {
    // Ignore
  }
}

afterAll(async () => {
  const root = path.join(__dirname, '..')

  let tmpA: string[] = []
  try {
    tmpA = await glob('**/__spec__/.tmp-*', {cwd: root, dot: true})
  } catch {
    // Ignore
  }

  let tmpB: string[] = []
  try {
    tmpB = await glob('.tmp-*', {cwd: root, dot: true})
  } catch {
    // Ignore
  }

  const packageRoot = path.join(root, '..')
  let tmpC: string[] = []
  try {
    tmpC = await glob('tmp-extjs-*', {cwd: packageRoot, dot: true})
  } catch {
    // Ignore
  }

  for (const d of [...tmpA, ...tmpB]) await rm(path.join(root, d))
  for (const d of tmpC) await rm(path.join(packageRoot, d))
})
