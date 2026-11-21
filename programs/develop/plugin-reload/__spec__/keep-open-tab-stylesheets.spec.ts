import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation, Compiler} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {buildPages, writePageProject} from '../../__spec__/helpers/page-builds'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resourcesKeptReachable} from '../../plugin-web-extension/shared/kept-resource-extensions'
import {ReloadPlugin} from '../index'
import {
  KeepOpenTabStylesheets,
  stylesheetsOpenTabsMayStillRead
} from '../steps/keep-open-tab-stylesheets'

const makeTempFolder = trackTempFolders()

function outputWith(files: string[]) {
  const output = makeTempFolder('extjs-open-tab-sheets-')

  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(output, file)), {recursive: true})
    fs.writeFileSync(path.join(output, file), '/* css */')
  }

  return output
}

const compilationOf = (compiler: object, mode: string, output?: string) =>
  ({
    compiler,
    options: {mode, output: {path: output}}
  }) as unknown as Compilation

describe('the stylesheets an open tab may still read', () => {
  it('names every sheet an earlier compile left under content_scripts', () => {
    const output = outputWith([
      'content_scripts/content-0.aaaaaaaa.css',
      'content_scripts/content-0.bbbbbbbb.css',
      'content_scripts/content-0.js',
      'content_scripts/nested/deep.css',
      'popup/styles.css'
    ])

    expect(stylesheetsOpenTabsMayStillRead(output).sort()).toEqual([
      'content_scripts/content-0.aaaaaaaa.css',
      'content_scripts/content-0.bbbbbbbb.css'
    ])
  })

  it('names nothing for an output with no content scripts or no folder at all', () => {
    expect(
      stylesheetsOpenTabsMayStillRead(outputWith(['popup/a.css']))
    ).toEqual([])

    expect(
      stylesheetsOpenTabsMayStillRead(path.join(outputWith([]), 'missing'))
    ).toEqual([])

    expect(stylesheetsOpenTabsMayStillRead(undefined)).toEqual([])
  })

  it('names nothing when content_scripts is a file', () => {
    const output = outputWith([])

    fs.writeFileSync(path.join(output, 'content_scripts'), 'not a folder')

    expect(stylesheetsOpenTabsMayStillRead(output)).toEqual([])
  })
})

describe('what the reload plugin keeps reachable for the manifest', () => {
  const left = 'content_scripts/content-0.aaaaaaaa.css'

  it('hands the leftover sheets to a development compile', () => {
    const compiler = {options: {mode: 'development'}}
    const output = outputWith([left])

    new KeepOpenTabStylesheets().apply(compiler as unknown as Compiler)

    expect(
      resourcesKeptReachable(compilationOf(compiler, 'development', output))
    ).toEqual([left])
  })

  it('hands nothing to a production compile, whose output starts clean', () => {
    const compiler = {options: {mode: 'production'}}
    const output = outputWith([left])

    new KeepOpenTabStylesheets().apply(compiler as unknown as Compiler)

    expect(
      resourcesKeptReachable(compilationOf(compiler, 'production', output))
    ).toEqual([])
  })

  it('is applied by the reload plugin with or without a reload session', () => {
    const output = outputWith([left])

    for (const devSession of [true, false]) {
      const compiler = {
        options: {mode: 'development', entry: {}, plugins: []},
        hooks: new Proxy(
          {},
          {
            get: () => ({
              tap() {},
              tapAsync() {},
              tapPromise() {}
            })
          }
        )
      }

      new ReloadPlugin({
        manifestPath: path.join(output, 'no-manifest.json'),
        browser: 'chrome',
        devSession
      }).apply(compiler as unknown as Compiler)

      expect(
        resourcesKeptReachable(compilationOf(compiler, 'development', output))
      ).toEqual([left])
    }
  })

  it('answers nothing for a compilation no plugin registered with', () => {
    expect(
      resourcesKeptReachable(
        compilationOf({}, 'development', outputWith([left]))
      )
    ).toEqual([])

    expect(
      resourcesKeptReachable({options: {}} as unknown as Compilation)
    ).toEqual([])
  })
})

describe('a sheet an earlier compile left, through a real dev session build', () => {
  it('is web accessible in the manifest the build emits', async () => {
    const root = fs.realpathSync(makeTempFolder('extjs-open-tab-build-'))
    const output = path.join(root, 'dist', 'chrome-development-session')
    const left = 'content_scripts/content-0.aaaaaaaa.css'

    writePageProject(root)
    fs.mkdirSync(path.join(output, 'content_scripts'), {recursive: true})
    fs.writeFileSync(path.join(output, left), 'body{color:red}')

    const built = await buildPages(root, 'development session')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(output, 'manifest.json'), 'utf8')
    ) as {web_accessible_resources?: Array<{resources: string[]}>}

    expect(built.errors).toEqual([])
    expect(
      (manifest.web_accessible_resources || []).flatMap(
        (group) => group.resources
      )
    ).toContain(left)
  }, 180_000)
})
