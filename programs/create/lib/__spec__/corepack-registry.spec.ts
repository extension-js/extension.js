import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {corepackRegistryEnv} from '../corepack-registry'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function belowHeader(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^(?:\/\/.*\n)+/, '')
}

describe('the create copy of corepackRegistryEnv', () => {
  it('hands Corepack the registry the project .npmrc pins', () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-corepack-registry-')
    )
    dirs.push(dir)
    fs.writeFileSync(
      path.join(dir, '.npmrc'),
      'registry=http://127.0.0.1:4874/\n'
    )

    expect(corepackRegistryEnv({}, dir)).toEqual({
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4874'
    })
  })

  it('matches programs/develop/lib/corepack-registry.ts below the header', () => {
    const copy = path.resolve(__dirname, '../corepack-registry.ts')
    const canonical = path.resolve(
      __dirname,
      '../../../develop/lib/corepack-registry.ts'
    )

    expect(belowHeader(canonical)).toContain(
      'export function corepackRegistryEnv'
    )

    expect(
      belowHeader(copy),
      'programs/create/lib/corepack-registry.ts drifted from programs/develop/lib/corepack-registry.ts. Copy the develop file over it and keep the create header. The three copies are duplicated on purpose, a cross-program import does not compile.'
    ).toBe(belowHeader(canonical))
  })
})
