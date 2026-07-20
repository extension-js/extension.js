/* @ts-nocheck */
import * as fs from 'node:fs'
import * as path from 'node:path'
import glob from 'tiny-glob'

async function rm(dir: string) {
  try {
    fs.rmSync(dir, {recursive: true, force: true})
  } catch {}
}

afterAll(async () => {
  const root = path.join(__dirname, '..')

  let tmpA: string[] = []
  try {
    tmpA = await glob('**/__spec__/.tmp-*', {cwd: root, dot: true})
  } catch {}

  let tmpB: string[] = []
  try {
    tmpB = await glob('.tmp-*', {cwd: root, dot: true})
  } catch {}

  const packageRoot = path.join(root, '..')
  let tmpC: string[] = []
  try {
    tmpC = await glob('tmp-extjs-*', {cwd: packageRoot, dot: true})
  } catch {}

  for (const d of [...tmpA, ...tmpB]) await rm(path.join(root, d))
  for (const d of tmpC) await rm(path.join(packageRoot, d))
})
