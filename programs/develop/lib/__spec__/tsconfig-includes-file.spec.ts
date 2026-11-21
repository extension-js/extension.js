import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {tsconfigCanIncludeFile} from '../tsconfig-includes-file'

const tempFolder = trackTempFolders()

function tree(files: Record<string, unknown>) {
  const root = fs.realpathSync(tempFolder('extjs-tsconfig-includes-'))

  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content)
    )
  }

  return root
}

function includesRootTypes(files: Record<string, unknown>, config = 'app') {
  const root = tree(files)

  return tsconfigCanIncludeFile(
    path.join(root, config, 'tsconfig.json'),
    path.join(root, config, 'extension-env.d.ts')
  )
}

describe('tsconfigCanIncludeFile', () => {
  it('reads include the way TypeScript does', () => {
    const cases: Array<[unknown, boolean]> = [
      [{}, true],
      [{include: ['./']}, true],
      [{include: ['.']}, true],
      [{include: ['**/*']}, true],
      [{include: ['*.d.ts']}, true],
      [{include: ['**/*.ts', '**/*.tsx']}, true],
      [{include: ['src', 'extension-env.d.ts']}, true],
      [{include: ['src']}, false],
      [{include: ['src/**/*']}, false],
      [{include: ['src', 'tests']}, false],
      [{include: ['*.tsx']}, false],
      [{include: []}, false],
      [{files: ['src/index.ts']}, false],
      [{files: ['./extension-env.d.ts']}, true],
      [{include: ['./'], exclude: ['*.d.ts']}, false],
      [{include: ['./'], exclude: ['node_modules', 'dist']}, true]
    ]

    for (const [config, expected] of cases) {
      expect(
        includesRootTypes({'app/tsconfig.json': config}),
        JSON.stringify(config)
      ).toBe(expected)
    }
  })

  it('takes include from the config it extends, relative to that config', () => {
    expect(
      includesRootTypes({
        'base/tsconfig.base.json': {include: ['src']},
        'app/tsconfig.json': {extends: '../base/tsconfig.base.json'}
      })
    ).toBe(false)

    expect(
      includesRootTypes({
        'base/tsconfig.base.json': {compilerOptions: {strict: true}},
        'app/tsconfig.json': {
          extends: '../base/tsconfig.base',
          include: ['src', 'tests']
        }
      })
    ).toBe(false)

    expect(
      includesRootTypes({
        'base/tsconfig.base.json': {compilerOptions: {strict: true}},
        'app/tsconfig.json': {extends: ['../base/tsconfig.base.json']}
      })
    ).toBe(true)

    expect(
      includesRootTypes({
        'app/node_modules/@scope/tsconfig/tsconfig.json': {include: ['src']},
        'app/node_modules/@scope/tsconfig/package.json': {
          name: '@scope/tsconfig'
        },
        'app/tsconfig.json': {extends: '@scope/tsconfig/tsconfig.json'}
      })
    ).toBe(false)
  })

  it('reads ${configDir} as the folder of the config being asked', () => {
    expect(
      includesRootTypes({
        'base/tsconfig.base.json': {include: ['${configDir}/*.d.ts']},
        'app/tsconfig.json': {extends: '../base/tsconfig.base.json'}
      })
    ).toBe(true)

    expect(
      includesRootTypes({
        'base/tsconfig.base.json': {include: ['${configDir}/src']},
        'app/tsconfig.json': {extends: '../base/tsconfig.base.json'}
      })
    ).toBe(false)

    expect(
      includesRootTypes({'app/tsconfig.json': {include: ['${configDir}']}})
    ).toBe(true)
  })

  it('follows a solution config to the projects it references', () => {
    const solution = {files: [], references: [{path: './tsconfig.app.json'}]}

    expect(
      includesRootTypes({
        'app/tsconfig.json': solution,
        'app/tsconfig.app.json': {include: ['src']}
      })
    ).toBe(false)

    expect(
      includesRootTypes({
        'app/tsconfig.json': solution,
        'app/tsconfig.app.json': {include: ['src', '*.d.ts']}
      })
    ).toBe(true)
  })

  it('assumes the file is read when the config cannot be parsed', () => {
    expect(includesRootTypes({'app/tsconfig.json': '{"include": ['})).toBe(true)
  })

  it('reads comments and trailing commas', () => {
    expect(
      includesRootTypes({
        'app/tsconfig.json': '{\n  // sources\n  "include": ["src",],\n}\n'
      })
    ).toBe(false)
  })
})
