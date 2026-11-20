import {describe, expect, it} from 'vitest'
import {
  compileProject,
  configure,
  MANIFEST,
  makeProject,
  swcOptionsFor,
  swcRules
} from './project-fixture'

const CLASS_FIELDS = 'class A {\n  x = 1\n}\nconsole.log(new A().x)\n'

describe('tsconfig transform flags reach SWC', () => {
  it('assigns class fields in the constructor when useDefineForClassFields is false', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture'},
      'manifest.json': MANIFEST,
      'tsconfig.json': {compilerOptions: {useDefineForClassFields: false}},
      'main.ts': CLASS_FIELDS
    })

    const {errors, read} = await compileProject(root, {main: './main.ts'})

    expect(errors).toEqual([])
    expect(read('main')).toMatch(/this\.x = 1/)
  }, 60_000)

  it('keeps class fields as defined fields when the flag is absent', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture'},
      'manifest.json': MANIFEST,
      'tsconfig.json': {compilerOptions: {strict: true}},
      'main.ts': CLASS_FIELDS
    })

    const {errors, read} = await compileProject(root, {main: './main.ts'})

    expect(errors).toEqual([])
    expect(read('main')).not.toMatch(/this\.x = 1/)
  }, 60_000)

  it('takes jsxImportSource from the tsconfig, through extends', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture', dependencies: {react: '19.0.0'}},
      'manifest.json': MANIFEST,
      'tsconfig.base.json': {
        compilerOptions: {jsxImportSource: '@emotion/react'}
      },
      'tsconfig.json': {extends: './tsconfig.base.json'}
    })

    const rules = swcRules(await configure(root))

    expect(
      swcOptionsFor(rules.pages, 'view.tsx').jsc.transform.react.importSource
    ).toBe('@emotion/react')

    expect(
      swcOptionsFor(rules.contentByPath, 'view.jsx').jsc.transform.react
        .importSource
    ).toBe('@emotion/react')
  })

  it('keeps the detected JSX runtime when the tsconfig names none', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture', dependencies: {preact: '10.0.0'}},
      'manifest.json': MANIFEST,
      'tsconfig.json': {compilerOptions: {jsx: 'react-jsx'}}
    })

    const rules = swcRules(await configure(root))

    expect(
      swcOptionsFor(rules.pages, 'view.tsx').jsc.transform.react.importSource
    ).toBe('preact')
  })
})
