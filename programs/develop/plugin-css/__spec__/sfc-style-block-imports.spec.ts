import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {workspacePackage} from '../../__spec__/helpers/workspace-package'
import deadCssUrlLoader from '../dead-css-url-loader'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

const VUE_QUERY = '?vue&type=style&index=0&id=731d5dd6&lang=css'

// The run ahead of PostCSS, on the request the framework makes for a block.
function runBlock(
  root: string,
  resource: string,
  resourceQuery: string,
  source: string
) {
  const warnings: Error[] = []
  const watched: string[] = []
  const output = deadCssUrlLoader.call(
    {
      resourcePath: path.join(root, resource),
      resourceQuery,
      getOptions: () => ({
        manifestPath: path.join(root, 'manifest.json'),
        projectPath: root,
        inlineImports: true
      }),
      emitWarning: (warning: Error) => warnings.push(warning),
      emitError() {},
      addDependency: (file: string) => watched.push(file),
      addMissingDependency() {}
    } as never,
    source
  )

  return {output, warnings, watched}
}

// A component's style block in a content script is added to the page as
// text. A relative @import has no base there, so the browser fetches nothing.
describe('an @import in the style block of a content script component', () => {
  it.each([
    ['Vue', 'content/Widget.vue', VUE_QUERY],
    // svelte-loader reads the block back from the component, under its path.
    ['Svelte', 'content/Widget.svelte', '']
  ])('%s: the rules of the imported sheet come in as CSS, and the sheet is watched', (_label, resource, query) => {
    const root = makeProject({
      'content/tokens.css': '.token{color:green}\n'
    })

    const {output, warnings, watched} = runBlock(
      root,
      resource,
      query,
      '@import "./tokens.css";\n.probe{color:red}\n'
    )

    expect(output).toBe('.token{color:green}\n\n.probe{color:red}\n')
    expect(watched).toEqual([path.join(root, 'content', 'tokens.css')])
    expect(warnings).toEqual([])
  })

  // The first request for a Vue block names the one that compiles it.
  it('leaves the request a framework wrote for the block as it is', () => {
    const root = makeProject({})
    const proxy =
      '@import "/x/Widget.vue.0.css!=!-!/x/loader.js!/x/Widget.vue?vue&type=style&index=0";\n'

    expect(runBlock(root, 'content/Widget.vue', VUE_QUERY, proxy)).toEqual({
      output: proxy,
      warnings: [],
      watched: []
    })
  })

  it('says a sheet it may not read is not bundled', () => {
    const root = makeProject({
      'content/.git/x.css': '.x{}\n'
    })

    const {warnings} = runBlock(
      root,
      'content/Widget.vue',
      VUE_QUERY,
      '@import "./.git/x.css";\n.probe{color:red}\n'
    )

    expect(warnings.map((w) => w.message.split('\n').slice(0, 3))).toEqual([
      [
        './.git/x.css is not bundled. Check the url() or @import that names it in this stylesheet.',
        'The build never bundles env files, tooling files or repository files. Move the contents into a file with another name.',
        'PATH content/Widget.vue'
      ]
    ])
  })
})

const VUE_PACKAGE = workspacePackage('vue')
const VUE_SCOPE = workspacePackage('@vue/runtime-dom')

describe.skipIf(!VUE_PACKAGE || !VUE_SCOPE || process.platform === 'win32')(
  'a Vue content script whose style block imports a sheet, built',
  () => {
    async function build(files: Record<string, string>) {
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
        ...files
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
        const summary = (await extensionBuild(root, {
          browser: 'chrome',
          silent: true,
          install: false,
          mode: 'production',
          exitOnError: false
        } as never)) as {
          errors_count: number
          warnings_count: number
          warnings?: string[]
        }

        expect(summary.warnings ?? []).toEqual([])
        expect(summary.errors_count).toBe(0)
        expect(summary.warnings_count).toBe(0)
      } finally {
        if (previous === undefined) delete process.env.VITEST
        else process.env.VITEST = previous
      }

      const dist = path.join(root, 'dist', 'chrome')

      return (fs.readdirSync(dist, {recursive: true}) as string[])
        .filter((entry) => entry.endsWith('.js'))
        .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
        .join('\n')
    }

    it('ships the imported rules in the script, with no @import left', async () => {
      const scripts = await build({
        'content/Widget.vue':
          '<template><p class="probe">x</p></template>\n<style>\n@import "./tokens.css";\n.probe{color:red}\n</style>\n',
        'content/tokens.css': '.token_from_import{color:green}\n'
      })

      expect(scripts).toContain('.token_from_import')
      expect(scripts).toContain('.probe')
      expect(scripts).not.toMatch(/@import\s*["']\.\/tokens\.css/)
    }, 120_000)

    // A custom element component takes each block as text for its shadow
    // root, where a relative @import has no base either.
    it('ships the imported rules in the text a custom element component reads', async () => {
      const scripts = await build({
        'content/scripts.js': [
          "import {defineCustomElement} from 'vue'",
          "import Widget from './Widget.ce.vue'",
          "customElements.define('ce-widget', defineCustomElement(Widget))",
          "document.body.append(document.createElement('ce-widget'))",
          ''
        ].join('\n'),
        'content/Widget.ce.vue':
          '<template><p class="ce_probe">x</p></template>\n<style>\n@import "./tokens.css";\n.ce_probe{color:red}\n</style>\n',
        'content/tokens.css':
          '@import "./deep.css";\n.token_from_import{color:green}\n',
        'content/deep.css': '.deep_from_import{color:blue}\n'
      })

      // The component's own `styles` list, in the order the sheets apply.
      expect(scripts).toMatch(
        /\["styles",\s*\["\\n\.deep_from_import\{color:blue\}\\n\.token_from_import\{color:green\}\\n\.ce_probe\{color:red\}\\n"\]\]/
      )

      expect(scripts).not.toContain('@import')
    }, 120_000)

    // The sheet comes in ahead of PostCSS and of the scoping of the block.
    it('runs the imported rules through the PostCSS config and the scoping of the block', async () => {
      const scripts = await build({
        'content/Widget.vue':
          '<template><p class="probe">x</p></template>\n<style scoped>\n@import "./card.css";\n.probe{color:red}\n</style>\n',
        'content/card.css': '.card_from_import{color:green}\n',
        'postcss.config.cjs': [
          'module.exports = {',
          '  plugins: [',
          '    {',
          "      postcssPlugin: 'marker',",
          '      Rule(rule) {',
          "        rule.prepend({prop: '--seen', value: 'yes'})",
          '      }',
          '    }',
          '  ]',
          '}',
          ''
        ].join('\n')
      })

      expect(
        scripts.match(/\.card_from_import\[data-v-[0-9a-f]+\]\{[^}]*\}/g)
      ).toEqual([
        expect.stringMatching(/\{--seen:\s*yes;\s*color:\s*green;?\}$/)
      ])
    }, 120_000)
  }
)

const SVELTE_PACKAGE = workspacePackage('svelte')
const SVELTE_LOADER = workspacePackage('svelte-loader')

describe.skipIf(
  !SVELTE_PACKAGE || !SVELTE_LOADER || process.platform === 'win32'
)('a Svelte content script whose style block imports a sheet, built', () => {
  it('runs the imported rules through the PostCSS config, once', async () => {
    const root = makeProject({
      'package.json': JSON.stringify({
        private: true,
        name: 'svelte-imports',
        version: '0.0.0',
        dependencies: {svelte: '*'}
      }),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'svelte-imports',
        version: '1.0.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      }),
      'content/scripts.js': [
        "import {mount} from 'svelte'",
        "import Widget from './Widget.svelte'",
        'mount(Widget, {target: document.body})',
        ''
      ].join('\n'),
      'content/Widget.svelte':
        '<p class="probe">x</p>\n\n<style>\n  @import "./card.css";\n  .probe { color: red; }\n</style>\n',
      'content/card.css': '.card_from_import{color:green}\n',
      'postcss.config.cjs': [
        'module.exports = {',
        '  plugins: [',
        '    {',
        "      postcssPlugin: 'marker',",
        '      Rule(rule) {',
        "        rule.prepend({prop: '--seen', value: 'yes'})",
        '      }',
        '    }',
        '  ]',
        '}',
        ''
      ].join('\n')
    })

    fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})

    for (const [name, source] of [
      ['svelte', SVELTE_PACKAGE],
      ['svelte-loader', SVELTE_LOADER]
    ] as const) {
      fs.symlinkSync(
        fs.realpathSync(source as string),
        path.join(root, 'node_modules', name),
        'dir'
      )
    }

    const {extensionBuild} = await import('../../command-build')
    const previous = process.env.VITEST

    process.env.VITEST = 'true'

    try {
      const summary = (await extensionBuild(root, {
        browser: 'chrome',
        silent: true,
        install: false,
        mode: 'production',
        exitOnError: false
      } as never)) as {errors_count: number; warnings?: string[]}

      expect(summary.warnings ?? []).toEqual([])
      expect(summary.errors_count).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }

    const dist = path.join(root, 'dist', 'chrome')
    const scripts = (fs.readdirSync(dist, {recursive: true}) as string[])
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
      .join('\n')

    expect(scripts.match(/\.card_from_import\{[^}]*\}/g)).toEqual([
      expect.stringMatching(/\{--seen:\s*yes;\s*color:\s*green;?\}$/)
    ])

    expect(scripts).not.toMatch(/@import\s*["']\.\/card\.css/)
  }, 120_000)
})
