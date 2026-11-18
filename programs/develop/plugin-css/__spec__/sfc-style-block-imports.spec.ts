import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {workspacePackage} from '../../__spec__/helpers/workspace-package'
import sfcStyleBlockLoader from '../sfc-style-block-loader'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()
const WARN = '⏵⏵⏵'

const VUE_QUERY = '?vue&type=style&index=0&id=731d5dd6&lang=css'

function runBlock(
  root: string,
  resource: string,
  resourceQuery: string,
  source: string
) {
  const warnings: Error[] = []
  const watched: string[] = []
  const output = sfcStyleBlockLoader.call(
    {
      resourcePath: path.join(root, resource),
      resourceQuery,
      mode: 'production',
      loaderIndex: 0,
      loaders: [
        {path: '/develop/dist/sfc-style-block-loader.mjs'},
        {
          path: resource.includes('.svelte')
            ? '/svelte-loader/index.js'
            : '/vue-loader/dist/index.js'
        }
      ],
      getOptions: () => ({
        manifestPath: path.join(root, 'manifest.json'),
        projectPath: root
      }),
      emitWarning: (warning: Error) => warnings.push(warning),
      emitError() {},
      addDependency: (file: string) => watched.push(file),
      addMissingDependency() {}
    } as never,
    source
  )

  return {output: String(output), warnings, watched}
}

// A component's style block in a content script is added to the page as
// text. A relative @import has no base there, so the browser fetches nothing.
describe('an @import in the style block of a content script component', () => {
  it.each([
    ['Vue', 'content/Widget.vue', VUE_QUERY],
    // svelte-loader reads the block back from the component, under its path.
    ['Svelte', 'content/Widget.svelte', '']
  ])('%s: the rules of the imported sheet come in, and the sheet is watched', (_label, resource, query) => {
    const root = makeProject({
      'content/tokens.css': '.token{color:green}\n'
    })

    const {output, warnings, watched} = runBlock(
      root,
      resource,
      query,
      '@import "./tokens.css";\n.probe{color:red}\n'
    )

    expect(output).toContain(
      JSON.stringify('.token{color:green}\n\n.probe{color:red}\n')
    )

    expect(output).not.toContain('@import')
    expect(watched).toEqual([path.join(root, 'content', 'tokens.css')])
    expect(warnings).toEqual([])
  })

  it('says why a sheet it may not read did not come in', () => {
    const root = makeProject({
      'content/.git/x.css': '.x{}\n'
    })

    const {warnings} = runBlock(
      root,
      'content/Widget.vue',
      VUE_QUERY,
      '@import "./.git/x.css";\n.probe{color:red}\n'
    )

    expect(warnings.map((w) => w.message.split('\n').slice(0, 4))).toEqual([
      [
        `${WARN} Couldn't bring an @import into this content script stylesheet, so the rules of that file will not load.`,
        'PATH content/Widget.vue',
        'IMPORT ./.git/x.css',
        'REASON The path holds .git, a name the build keeps private.'
      ]
    ])
  })
})

const VUE_PACKAGE = workspacePackage('vue')
const VUE_SCOPE = workspacePackage('@vue/runtime-dom')

describe.skipIf(!VUE_PACKAGE || !VUE_SCOPE || process.platform === 'win32')(
  'a Vue content script whose style block imports a sheet, built',
  () => {
    it('ships the imported rules in the script, with no @import left', async () => {
      const root = makeProject({
        'package.json': JSON.stringify({
          private: true,
          name: 'sfc-imports',
          version: '0.0.0',
          dependencies: {vue: '*'}
        }),
        'manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'sfc-imports',
          version: '1.0.0',
          content_scripts: [
            {matches: ['<all_urls>'], js: ['content/scripts.js']}
          ]
        }),
        'content/scripts.js': [
          "import {createApp} from 'vue'",
          "import Widget from './Widget.vue'",
          "const host = document.createElement('div')",
          'document.body.append(host)',
          'createApp(Widget).mount(host)',
          ''
        ].join('\n'),
        'content/Widget.vue':
          '<template><p class="probe">x</p></template>\n<style>\n@import "./tokens.css";\n.probe{color:red}\n</style>\n',
        'content/tokens.css': '.token_from_import{color:green}\n'
      })

      fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})
      fs.symlinkSync(
        fs.realpathSync(VUE_PACKAGE as string),
        path.join(root, 'node_modules', 'vue'),
        'dir'
      )

      fs.symlinkSync(
        fs.realpathSync(path.dirname(VUE_SCOPE as string)),
        path.join(root, 'node_modules', '@vue'),
        'dir'
      )

      const {extensionBuild} = await import('../../command-build')
      const previous = process.env.VITEST

      process.env.VITEST = 'true'

      try {
        const summary = await extensionBuild(root, {
          browser: 'chrome',
          silent: true,
          install: false,
          mode: 'production',
          exitOnError: false
        } as never)

        expect(summary.errors_count).toBe(0)
        expect(summary.warnings_count).toBe(0)
      } finally {
        if (previous === undefined) delete process.env.VITEST
        else process.env.VITEST = previous
      }

      const dist = path.join(root, 'dist', 'chrome')
      const scripts = (fs.readdirSync(dist, {recursive: true}) as string[])
        .filter((entry) => entry.endsWith('.js'))
        .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
        .join('\n')

      expect(scripts).toContain('.token_from_import')
      expect(scripts).toContain('.probe')
      expect(scripts).not.toMatch(/@import\s*["']\.\/tokens\.css/)
    }, 120_000)
  }
)
