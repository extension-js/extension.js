import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../css-lib/messages'
import {maybeUsePostCss} from '../css-tools/postcss'
import preprocessorPassthroughLoader from '../preprocessor-passthrough-loader'
import {configureCss, cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

afterEach(() => {
  vi.restoreAllMocks()
})

function project(packageManager: string, files: Record<string, string> = {}) {
  return makeProject({
    'package.json': JSON.stringify({name: 'css-fixture', packageManager}),
    ...files
  })
}

const lastLine = (message: string) => message.split('\n').at(-1)

// The command a message tells the reader to run is the one for the package
// manager the project names, never npm by default.
describe.each([
  ['npm@11.0.0', 'npm install -D'],
  ['pnpm@10.0.0', 'pnpm add -D'],
  ['yarn@4.0.0', 'yarn add -D'],
  ['bun@1.2.0', 'bun add -D']
])('the install command in a project pinned to %s', (packageManager, add) => {
  it('names that manager for a PostCSS plugin that did not resolve', async () => {
    const root = project(packageManager, {
      '.postcssrc.json': JSON.stringify({
        plugins: {'postcss-plugin-nowhere': {}}
      })
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await maybeUsePostCss(root, {mode: 'development'})

    expect(error.mock.calls.map(([message]) => lastLine(message))).toEqual([
      `Install it in your project to re-enable it: ${add} postcss-plugin-nowhere`
    ])
  })

  it('names that manager for a Sass or Less file that shipped uncompiled', async () => {
    const root = project(packageManager)
    const rules = await configureCss(root, 'development')
    const passthrough = rules
      .flatMap(
        (rule) =>
          (rule.use || []) as Array<{
            loader?: string
            options: {install: Record<'sass' | 'less', string>}
          }>
      )
      .find((item) =>
        String(item.loader).includes('preprocessor-passthrough-loader')
      )
    const warnings: Error[] = []

    for (const file of ['styles.scss', 'styles.less']) {
      preprocessorPassthroughLoader.call(
        {
          resourcePath: path.join(root, file),
          rootContext: root,
          getOptions: () =>
            passthrough?.options ?? {install: {sass: '', less: ''}},
          emitWarning: (warning: Error) => warnings.push(warning)
        },
        ''
      )
    }

    expect(warnings.map((warning) => lastLine(warning.message))).toEqual([
      `Install it to compile this file: ${add} sass`,
      `Install it to compile this file: ${add} less`
    ])
  })
})

describe('the Sass package that is declared and not installed', () => {
  it('is reported with the one command it was given', () => {
    expect(
      messages.missingSassDependency('pnpm add -D sass').split('\n').slice(1)
    ).toEqual([
      "The sass package isn't installed in your project.",
      'Add it to your devDependencies: pnpm add -D sass'
    ])
  })
})
