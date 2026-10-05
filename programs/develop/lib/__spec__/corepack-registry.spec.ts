import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {corepackRegistryEnv} from '../corepack-registry'

const dirs: string[] = []

function project(npmrc: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-corepack-registry-'))
  dirs.push(dir)

  if (npmrc !== null) fs.writeFileSync(path.join(dir, '.npmrc'), npmrc)

  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('corepackRegistryEnv', () => {
  it('hands Corepack the registry the project .npmrc pins', () => {
    const dir = project(
      'fetch-retries=0\nregistry=http://127.0.0.1:4873/\naudit=false\n'
    )

    expect(corepackRegistryEnv({}, dir)).toEqual({
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4873'
    })
  })

  it('keeps a registry path and drops only the trailing slash', () => {
    const dir = project(
      'registry = "https://npm.corp.example/api/npm/virtual/"\r\n'
    )

    expect(corepackRegistryEnv({}, dir)).toEqual({
      COREPACK_NPM_REGISTRY: 'https://npm.corp.example/api/npm/virtual'
    })
  })

  it('reads the last registry line, the one the package manager honors', () => {
    const dir = project(
      'registry=http://127.0.0.1:1001/\nregistry=http://127.0.0.1:1002/\n'
    )

    expect(corepackRegistryEnv({}, dir)).toEqual({
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:1002'
    })
  })

  it('lets a registry in the environment outrank the project file', () => {
    const dir = project('registry=http://127.0.0.1:1001/\n')

    expect(
      corepackRegistryEnv({NPM_CONFIG_REGISTRY: 'http://127.0.0.1:1003/'}, dir)
    ).toEqual({COREPACK_NPM_REGISTRY: 'http://127.0.0.1:1003'})

    expect(
      corepackRegistryEnv(
        {npm_config_registry: 'https://registry.npmjs.org/'},
        dir
      )
    ).toEqual({})
  })

  it('falls back to the project file when the environment value is empty', () => {
    const dir = project('registry=http://127.0.0.1:1001/\n')

    expect(corepackRegistryEnv({npm_config_registry: ''}, dir)).toEqual({
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:1001'
    })
  })

  it('never replaces a Corepack registry the user already exported', () => {
    const dir = project('registry=http://127.0.0.1:1001/\n')

    expect(
      corepackRegistryEnv({COREPACK_NPM_REGISTRY: 'http://127.0.0.1:1004'}, dir)
    ).toEqual({})

    expect(
      corepackRegistryEnv({corepack_npm_registry: 'http://127.0.0.1:1004'}, dir)
    ).toEqual({})
  })

  it.each([
    ['no .npmrc', null],
    ['an .npmrc with no registry', 'audit=false\n'],
    ['the public npm registry', 'registry=https://registry.npmjs.org/\n'],
    ['the public Yarn registry', 'registry=https://registry.yarnpkg.com\n'],
    ['only a scoped registry', '@corp:registry=http://127.0.0.1:1001/\n'],
    ['a commented registry', '; registry=http://127.0.0.1:1001/\n'],
    ['an unexpanded variable', `registry=https://${'$'}{NPM_HOST}/npm/\n`],
    ['a value that is not a URL', 'registry=not a url\n'],
    ['a non-http protocol', 'registry=file:///srv/registry\n']
  ])('sets nothing for %s', (_label, npmrc) => {
    expect(corepackRegistryEnv({}, project(npmrc))).toEqual({})
  })
})
