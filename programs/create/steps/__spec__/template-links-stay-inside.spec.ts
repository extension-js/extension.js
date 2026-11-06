import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {copyDirectoryWithSymlinks, moveDirectoryContents} from '../../lib/utils'

const dirs: string[] = []

async function tempDir(prefix: string) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  )
  dirs.push(dir)

  return dir
}

async function templateWithLinks() {
  const outside = await tempDir('outside')
  await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours')

  const template = await tempDir('template')
  await fs.mkdir(path.join(template, 'src', 'shared'), {recursive: true})
  await fs.writeFile(path.join(template, 'src', 'shared', 'util.js'), 'ok')
  await fs.writeFile(path.join(template, 'manifest.json'), '{}')

  await fs.symlink('shared/util.js', path.join(template, 'src', 'inside.js'))
  await fs.symlink(
    path.join(template, 'src', 'shared'),
    path.join(template, 'src', 'absolute-inside')
  )

  await fs.symlink(
    path.join(outside, 'secret.txt'),
    path.join(template, 'package.json')
  )

  await fs.symlink('../../outside-by-steps', path.join(template, 'README.md'))
  await fs.symlink('missing-file', path.join(template, 'src', 'dangling.js'))

  return {template, outside}
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, {recursive: true, force: true})
  }
})

async function expectLinksKeptInside(destination: string, outside: string) {
  const inside = await fs.readlink(path.join(destination, 'src', 'inside.js'))
  expect(inside.split(path.sep).join('/')).toBe('shared/util.js')
  expect(
    await fs.readFile(path.join(destination, 'src', 'inside.js'), 'utf8')
  ).toBe('ok')

  const absolute = await fs.readlink(
    path.join(destination, 'src', 'absolute-inside')
  )
  expect(path.isAbsolute(absolute)).toBe(false)
  expect(
    await fs.readdir(path.join(destination, 'src', 'absolute-inside'))
  ).toEqual(['util.js'])

  for (const name of ['package.json', 'README.md', 'src/dangling.js']) {
    await expect(fs.lstat(path.join(destination, name))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  }

  await fs.writeFile(path.join(destination, 'package.json'), '{"name":"x"}')
  expect(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe(
    'not yours'
  )
}

describe('a link a template carries', () => {
  it('is copied only when it stays inside the template', async () => {
    const {template, outside} = await templateWithLinks()
    const destination = await tempDir('copied')

    const dropped = await copyDirectoryWithSymlinks(template, destination)

    expect(dropped.sort()).toEqual([
      'README.md',
      'package.json',
      'src/dangling.js'
    ])

    await expectLinksKeptInside(destination, outside)
  })

  it('is moved only when it stays inside the template', async () => {
    const {template, outside} = await templateWithLinks()
    const destination = await tempDir('moved')

    const dropped = await moveDirectoryContents(template, destination)

    expect(dropped.sort()).toEqual([
      'README.md',
      'package.json',
      'src/dangling.js'
    ])

    await expectLinksKeptInside(destination, outside)
    await expect(fs.stat(template)).rejects.toMatchObject({code: 'ENOENT'})
  })
})
