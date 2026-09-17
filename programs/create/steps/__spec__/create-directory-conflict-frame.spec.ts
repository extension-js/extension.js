import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {hasChannelPrefix} from '../../lib/messaging'
import {createDirectory} from '../create-directory'

const dirs: string[] = []
const logger = {log: () => {}, error: () => {}}
const GLYPH = '⏵⏵⏵'
const ANSI = /\[[0-9;]*m/g

async function directoryHoldingAProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-conflict-'))
  dirs.push(dir)
  await fs.writeFile(path.join(dir, 'package.json'), '{}')

  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, {recursive: true, force: true})
  }
})

describe('creating into a directory that already holds a project', () => {
  it('reports the conflict once, with no second frame around it', async () => {
    const dir = await directoryHoldingAProject()

    const error = (await createDirectory(dir, 'my-extension', logger).catch(
      (thrown: Error) => thrown
    )) as Error

    const message = error.message.replace(ANSI, '')

    expect(message).toContain(
      'already contains files that would be overwritten'
    )

    expect(message).toContain('package.json')
    // The frame this used to carry prescribed a permissions remedy for a
    // conflict that has nothing to do with permissions.
    expect(message).not.toContain("Couldn't create the directory")
    expect(message).not.toContain('Check the path and its permissions')
    expect(message).not.toContain('REASON')
    expect(hasChannelPrefix(message)).toBe(true)
    expect(message.match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
  })

  it('still creates an empty directory without complaining', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'create-fresh-'))
    dirs.push(parent)

    await expect(
      createDirectory(path.join(parent, 'fresh'), 'fresh', logger)
    ).resolves.toEqual({directoryCreated: true})
  })
})
