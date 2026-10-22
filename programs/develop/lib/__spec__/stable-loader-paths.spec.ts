import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  locateLoaderPackage,
  projectLocalLoaderPath,
  rewriteRuleLoaderPaths
} from '../stable-loader-paths'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function tmp(name: string) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `extjs-${name}-`))
  )
  roots.push(root)

  return root
}

// A develop checkout outside the project, a project whose node_modules links
// to it (npm link, pnpm), and a hoisted third-party loader in the project.
function layout() {
  const checkout = path.join(tmp('checkout'), 'programs', 'develop')
  fs.mkdirSync(path.join(checkout, 'dist'), {recursive: true})
  fs.writeFileSync(path.join(checkout, 'dist', 'wrapper.js'), '')
  fs.mkdirSync(path.join(checkout, 'node_modules', 'postcss-loader', 'dist'), {
    recursive: true
  })

  fs.writeFileSync(
    path.join(checkout, 'node_modules', 'postcss-loader', 'dist', 'cjs.js'),
    ''
  )

  const project = path.join(tmp('project'), 'app')
  fs.mkdirSync(path.join(project, 'node_modules'), {recursive: true})
  fs.symlinkSync(
    checkout,
    path.join(project, 'node_modules', 'extension-develop'),
    'dir'
  )

  fs.mkdirSync(path.join(project, 'node_modules', 'postcss-loader', 'dist'), {
    recursive: true
  })

  fs.writeFileSync(
    path.join(project, 'node_modules', 'postcss-loader', 'dist', 'cjs.js'),
    ''
  )

  return {checkout, project}
}

describe('stable loader paths', () => {
  it('names a loader by its package and the path inside it', () => {
    expect(
      locateLoaderPackage('/a/node_modules/postcss-loader/dist/cjs.js')
    ).toEqual({name: 'postcss-loader', inside: 'dist/cjs.js'})

    expect(
      locateLoaderPackage(
        '/a/node_modules/.pnpm/x@1/node_modules/@scope/pkg/lib/loader.js'
      )
    ).toEqual({name: '@scope/pkg', inside: 'lib/loader.js'})

    expect(
      locateLoaderPackage('/src/extension.js/programs/develop/dist/wrapper.js')
    ).toBeUndefined()

    expect(
      locateLoaderPackage(
        '/src/extension.js/programs/develop/dist/wrapper.js',
        '/src/extension.js/programs/develop'
      )
    ).toEqual({name: 'extension-develop', inside: 'dist/wrapper.js'})
  })

  it('names a linked develop loader through the project node_modules', () => {
    const {checkout, project} = layout()

    expect(
      projectLocalLoaderPath(
        path.join(checkout, 'dist', 'wrapper.js'),
        project,
        checkout
      )
    ).toBe(
      path.join(
        project,
        'node_modules',
        'extension-develop',
        'dist',
        'wrapper.js'
      )
    )
  })

  it('keeps a loader that is not the file the project node_modules holds', () => {
    const {checkout, project} = layout()
    const ownCopy = path.join(
      checkout,
      'node_modules',
      'postcss-loader',
      'dist',
      'cjs.js'
    )

    expect(projectLocalLoaderPath(ownCopy, project, checkout)).toBe(ownCopy)
  })

  it('leaves a project-local path, a bare name and a stranger alone', () => {
    const {checkout, project} = layout()
    const local = path.join(
      project,
      'node_modules',
      'postcss-loader',
      'dist',
      'cjs.js'
    )

    expect(projectLocalLoaderPath(local, project, checkout)).toBe(local)
    expect(projectLocalLoaderPath('sass-loader', project, checkout)).toBe(
      'sass-loader'
    )

    expect(
      projectLocalLoaderPath('/elsewhere/loader.js', project, checkout)
    ).toBe('/elsewhere/loader.js')
  })

  it('rewrites every loader string in the rule tree in place', () => {
    const options = {a: 1}
    const rules = [
      {test: /\.css$/, loader: '/real/x.js'},
      {test: /\.ts$/, use: ['/real/y.js', {loader: '/real/z.js', options}]},
      {oneOf: [{use: {loader: '/real/w.js'}}]},
      {rules: [{use: '/real/v.js'}]},
      '...',
      null
    ]
    const useObject = (rules[1] as {use: unknown[]}).use[1]

    rewriteRuleLoaderPaths(rules, (loader) =>
      loader.replace('/real/', '/local/')
    )

    expect(rules[0]).toMatchObject({loader: '/local/x.js'})
    expect((rules[1] as {use: unknown[]}).use).toEqual([
      '/local/y.js',
      {loader: '/local/z.js', options}
    ])

    expect((rules[1] as {use: unknown[]}).use[1]).toBe(useObject)
    expect(
      (rules[2] as {oneOf: Array<{use: {loader: string}}>}).oneOf[0].use.loader
    ).toBe('/local/w.js')

    expect((rules[3] as {rules: Array<{use: string}>}).rules[0].use).toBe(
      '/local/v.js'
    )
  })
})
