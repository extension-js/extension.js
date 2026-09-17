import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {copyDirectoryWithSymlinks, NEVER_SCAFFOLDED_DIRS} from '../../lib/utils'

const dirs: string[] = []

async function templateCheckout() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'template-checkout-'))
  dirs.push(dir)

  await fs.mkdir(path.join(dir, 'src'), {recursive: true})
  await fs.writeFile(path.join(dir, 'src', 'background.js'), 'export {}')
  await fs.writeFile(path.join(dir, 'package.json'), '{}')

  // What a `dev` run inside the template leaves behind.
  await fs.mkdir(path.join(dir, 'dist', 'extension-js', 'chromium'), {
    recursive: true
  })

  await fs.writeFile(
    path.join(dir, 'dist', 'extension-js', 'chromium', 'ready.json'),
    '{}'
  )

  await fs.mkdir(path.join(dir, 'node_modules', 'left-pad'), {recursive: true})
  await fs.writeFile(path.join(dir, 'node_modules', 'left-pad', 'i.js'), '')
  await fs.mkdir(path.join(dir, '.extension-js'), {recursive: true})
  await fs.writeFile(path.join(dir, '.extension-js', 'port'), '8080')

  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, {recursive: true, force: true})
  }
})

describe('copying a template that is also somebody working checkout', () => {
  it('carries the sources and leaves the build output behind', async () => {
    const source = await templateCheckout()
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-'))
    dirs.push(destination)

    await copyDirectoryWithSymlinks(source, destination)

    const copied = await fs.readdir(destination)

    expect(copied.sort()).toEqual(['package.json', 'src'])
    expect(await fs.readdir(path.join(destination, 'src'))).toEqual([
      'background.js'
    ])
  })

  it('names the three directories a scaffold never inherits', () => {
    expect(NEVER_SCAFFOLDED_DIRS).toEqual([
      'dist',
      'node_modules',
      '.extension-js'
    ])
  })
})
