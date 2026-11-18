import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {swcDecoratorTransform} from '../../js-tools/decorators'
import {
  compileProject,
  configure,
  fakePackage,
  MANIFEST,
  makeProject,
  swcOptionsFor,
  swcRules
} from '../project-fixture'

const LEGACY = {compilerOptions: {experimentalDecorators: true}}
const LEGACY_WITH_METADATA = {
  compilerOptions: {experimentalDecorators: true, emitDecoratorMetadata: true}
}

const DECORATED_TS = [
  'const log = (...args: unknown[]) => args[0] as any',
  'class Service {}',
  '@log',
  'class A {',
  '  constructor(readonly service: Service) {}',
  '  @log method(value: string) {',
  '    return value',
  '  }',
  '}',
  'console.log(A)',
  ''
].join('\n')

describe('swcDecoratorTransform', () => {
  const configAt = (files: Record<string, string | object>, name: string) =>
    path.join(makeProject(files), name)

  it.each([
    ['experimentalDecorators', LEGACY, {legacyDecorator: true}],
    [
      'experimentalDecorators and emitDecoratorMetadata',
      LEGACY_WITH_METADATA,
      {legacyDecorator: true, decoratorMetadata: true}
    ],
    ['no decorator option', {}, {decoratorVersion: '2022-03'}],
    [
      'emitDecoratorMetadata alone',
      {compilerOptions: {emitDecoratorMetadata: true}},
      {decoratorVersion: '2022-03'}
    ]
  ])('reads %s', (_name, tsconfig, expected) => {
    expect(
      swcDecoratorTransform(
        configAt({'tsconfig.json': tsconfig}, 'tsconfig.json')
      )
    ).toEqual(expected)
  })

  it('chooses standard decorators with no config at all', () => {
    expect(swcDecoratorTransform(undefined)).toEqual({
      decoratorVersion: '2022-03'
    })
  })

  it('reads a jsconfig the same way', () => {
    expect(
      swcDecoratorTransform(
        configAt({'jsconfig.json': LEGACY}, 'jsconfig.json')
      )
    ).toEqual({legacyDecorator: true})
  })

  it('follows extends to a file, the nearest config winning', () => {
    const root = makeProject({
      'tsconfig.base.json': LEGACY_WITH_METADATA,
      'tsconfig.json': {extends: './tsconfig.base'},
      'tsconfig.off.json': {
        extends: './tsconfig.base.json',
        compilerOptions: {experimentalDecorators: false}
      }
    })

    expect(swcDecoratorTransform(path.join(root, 'tsconfig.json'))).toEqual({
      legacyDecorator: true,
      decoratorMetadata: true
    })

    expect(swcDecoratorTransform(path.join(root, 'tsconfig.off.json'))).toEqual(
      {
        decoratorVersion: '2022-03'
      }
    )
  })

  it('follows extends to a package and through an array, later entries winning', () => {
    const root = makeProject({
      'tsconfig.json': {extends: ['@acme/tsconfig', './metadata.json']},
      'metadata.json': {compilerOptions: {emitDecoratorMetadata: true}}
    })
    fakePackage(
      root,
      '@acme/tsconfig',
      {},
      {'tsconfig.json': JSON.stringify(LEGACY)}
    )

    expect(swcDecoratorTransform(path.join(root, 'tsconfig.json'))).toEqual({
      legacyDecorator: true,
      decoratorMetadata: true
    })
  })

  it('reads comments and trailing commas, and survives a cycle or a broken file', () => {
    const root = makeProject({
      'tsconfig.json':
        '{\n  // legacy\n  "extends": "./a.json",\n  "compilerOptions": {"experimentalDecorators": true,},\n}\n',
      'a.json': {extends: './tsconfig.json'},
      'broken.json': '{"compilerOptions": '
    })

    expect(swcDecoratorTransform(path.join(root, 'tsconfig.json'))).toEqual({
      legacyDecorator: true
    })

    expect(swcDecoratorTransform(path.join(root, 'broken.json'))).toEqual({
      decoratorVersion: '2022-03'
    })
  })
})

describe('the SWC rules a project gets', () => {
  it('turn the decorators parser flag on for every file kind and carry the config semantics', async () => {
    const root = makeProject({
      'package.json': {},
      'manifest.json': MANIFEST,
      'tsconfig.json': LEGACY
    })
    const {all} = swcRules(await configure(root))

    for (const rule of all) {
      for (const file of ['/x/a.ts', '/x/a.tsx', '/x/a.js', '/x/a.jsx']) {
        const {jsc} = swcOptionsFor(rule, file)

        expect(jsc.parser.decorators).toBe(true)
        expect(jsc.transform.legacyDecorator).toBe(true)
        expect(jsc.transform.decoratorVersion).toBeUndefined()
      }
    }
  })
})

describe('compiling decorators', () => {
  async function compile(
    files: Record<string, string | object>,
    entry: string
  ) {
    const root = makeProject({
      'package.json': {},
      'manifest.json': MANIFEST,
      ...files
    })

    return compileProject(root, {main: `./${entry}`})
  }

  it('builds legacy decorators with metadata when the tsconfig asks', async () => {
    const {errors, read} = await compile(
      {'tsconfig.json': LEGACY_WITH_METADATA, 'main.ts': DECORATED_TS},
      'main.ts'
    )

    expect(errors).toEqual([])
    expect(read('main')).toContain('_ts_decorate')
    expect(read('main')).toContain('"design:paramtypes"')
  })

  it('builds legacy decorators without metadata', async () => {
    const {errors, read} = await compile(
      {'tsconfig.json': LEGACY, 'main.ts': DECORATED_TS},
      'main.ts'
    )

    expect(errors).toEqual([])
    expect(read('main')).toContain('_ts_decorate')
    expect(read('main')).not.toContain('design:paramtypes')
  })

  it('builds standard decorators when the tsconfig has no experimentalDecorators', async () => {
    const {errors, read} = await compile(
      {'tsconfig.json': {}, 'main.ts': DECORATED_TS},
      'main.ts'
    )

    expect(errors).toEqual([])
    expect(read('main')).toContain('_apply_decs_2203_r')
    expect(read('main')).not.toContain('_ts_decorate')
  })

  it('builds a decorated .js file in a JavaScript project', async () => {
    const {errors, read} = await compile(
      {
        'jsconfig.json': {},
        'main.js': 'const log = (c) => c\n@log class A {}\nconsole.log(A)\n'
      },
      'main.js'
    )

    expect(errors).toEqual([])
    expect(read('main')).toContain('_apply_decs_2203_r')
  })

  it('leaves code without decorators byte for byte as it was, whatever the config', async () => {
    const source = [
      'enum Kind { A, B }',
      'class Store {',
      '  count = 0',
      '  #secret = Kind.B',
      '  read() {',
      '    return this.#secret ?? this.count',
      '  }',
      '}',
      'console.log(new Store().read())',
      ''
    ].join('\n')
    const builds = await Promise.all(
      [{}, LEGACY, LEGACY_WITH_METADATA, undefined].map((tsconfig) =>
        compile(
          tsconfig === undefined
            ? {'main.ts': source}
            : {'tsconfig.json': tsconfig, 'main.ts': source},
          'main.ts'
        )
      )
    )

    for (const build of builds) expect(build.errors).toEqual([])

    const [first, ...rest] = builds.map((build) => build.read('main'))
    for (const output of rest) expect(output).toBe(first)
  })
})
