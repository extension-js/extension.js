/* @ts-nocheck */
import * as fs from 'fs'
import * as path from 'path'
import glob from 'tiny-glob'

async function rm(dir: string) {
  try {
    fs.rmSync(dir, {recursive: true, force: true})
  } catch {}
}

afterAll(async () => {
  const root = path.join(__dirname, '..')
  // Guard when webpack subtree does not exist in this package variant
  let tmpA: string[] = []
  try {
    if (fs.existsSync(path.join(root, 'webpack'))) {
      tmpA = await glob('webpack/**/__spec__/.tmp-*', {cwd: root, dot: true})
    }
  } catch {}
  let tmpB: string[] = []
  try {
    tmpB = await glob('.tmp-*', {cwd: root, dot: true})
  } catch {}
  for (const d of [...tmpA, ...tmpB]) await rm(path.join(root, d))
})
