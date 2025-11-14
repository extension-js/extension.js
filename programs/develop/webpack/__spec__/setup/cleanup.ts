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
  // Point root to the webpack directory
  const root = path.join(__dirname, '..')

  // Remove any temporary folders created under any __spec__ subtree
  let tmpA: string[] = []
  try {
    tmpA = await glob('**/__spec__/.tmp-*', {cwd: root, dot: true})
  } catch {}

  // Also clean direct .tmp-* folders at the webpack root, if any
  let tmpB: string[] = []
  try {
    tmpB = await glob('.tmp-*', {cwd: root, dot: true})
  } catch {}

  for (const d of [...tmpA, ...tmpB]) await rm(path.join(root, d))
})
