import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {scaffoldNeedsTypeDefinitions} from '../../lib/utils'

const dirs: string[] = []

async function scaffold(files: string[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-types-'))
  dirs.push(dir)

  for (const file of files) {
    await fs.writeFile(path.join(dir, file), '{}')
  }

  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, {recursive: true, force: true})
  }
})

describe('which scaffolds are handed extension-env.d.ts at create time', () => {
  it('covers the templates whose name says TypeScript', async () => {
    const dir = await scaffold(['package.json', 'tsconfig.json'])

    for (const template of [
      'typescript',
      'react',
      'preact',
      'svelte',
      'solid'
    ]) {
      await expect(scaffoldNeedsTypeDefinitions(dir, template)).resolves.toBe(
        true
      )
    }
  })

  it('covers a TypeScript template whose name never says so', async () => {
    const dir = await scaffold(['package.json', 'tsconfig.json'])

    // vue, the ai templates and playwright all scaffold a tsconfig, and all of
    // them used to reach their first dev run without the types file.
    for (const template of [
      'vue',
      'ai-claude',
      'playwright',
      'newtab-crypto'
    ]) {
      await expect(scaffoldNeedsTypeDefinitions(dir, template)).resolves.toBe(
        true
      )
    }
  })

  it('leaves a plain JavaScript scaffold alone', async () => {
    const dir = await scaffold(['package.json'])

    await expect(scaffoldNeedsTypeDefinitions(dir, 'javascript')).resolves.toBe(
      false
    )

    await expect(scaffoldNeedsTypeDefinitions(dir, 'content')).resolves.toBe(
      false
    )
  })
})
