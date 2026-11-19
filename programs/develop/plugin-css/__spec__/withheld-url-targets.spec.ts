import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {workspacePackage} from '../../__spec__/helpers/workspace-package'
import {cssProjects, expectNoWorkspaceAbove} from './helpers/css-project'

const makeProject = cssProjects()

afterEach(() => {
  vi.unstubAllEnvs()
})

// Windows makes no link without a setting most machines lack.
const LINKS = process.platform !== 'win32'

type Route = 'content' | 'page' | 'listed'

// What each line names, which routes warn of it, and how its address stays.
const LINES: Array<{
  css: string
  request: string
  warns: Route[]
  kept?: boolean
}> = [
  {
    css: '.a{background:url(./.env)}',
    request: './.env',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.b{background:url("./.env.local")}',
    request: './.env.local',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.c{background:url(../../shared/outside.png)}',
    request: '../../shared/outside.png',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.e{background:url(./node_modules/pkg/.env)}',
    request: './node_modules/pkg/.env',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.f{background:url(./node_modules/pkg/img.png)}',
    request: '',
    warns: []
  },
  {
    css: '.g{background:url(./.npmrc)}',
    request: './.npmrc',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.h{background:url(./.envrc)}',
    request: './.envrc',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.i{background:url(./.git/config)}',
    request: './.git/config',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.j{background:url(./.DS_Store)}',
    request: './.DS_Store',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {css: '.k{background:url(./.env.example)}', request: '', warns: []},
  // A bare name is a path to CSS and to the bundler, which tries it first.
  {
    css: '.l{background:url(.env)}',
    request: '.env',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  // A sheet's ending does not make a url() an @import.
  {
    css: '.m{background:url(./.env.css)}',
    request: './.env.css',
    warns: ['content', 'page', 'listed'],
    kept: true
  },
  {
    css: '.n{background-image:image-set("./set/.env" 1x)}',
    request: './set/.env',
    warns: ['content', 'page', 'listed']
  },
  // A page sheet makes no request of a src() string, so nothing ships.
  {
    css: '@font-face{font-family:x;src:src("./src/.env")}',
    request: './src/.env',
    warns: ['content']
  },
  // The bundler reads these as a package and through an alias. The content
  // script sheet keeps both as written, which no file stands behind there.
  {
    css: '.o{background:url(pkg/.env)}',
    request: 'pkg/.env',
    warns: ['page', 'listed']
  },
  {
    css: '.p{background:url(secretalias/.env)}',
    request: 'secretalias/.env',
    warns: ['page', 'listed']
  },
  ...(LINKS
    ? [
        {
          css: '.d{background:url(./linked.png)}',
          request: './linked.png',
          warns: ['content', 'page', 'listed'] as Route[],
          kept: true
        }
      ]
    : [])
]

const MARKERS = [
  'MARKER_ENV',
  'MARKER_LOCAL',
  'MARKER_PKG_ENV',
  'MARKER_SHARED_IMAGE',
  'MARKER_NPMRC',
  'MARKER_ENVRC',
  'MARKER_GIT_CONFIG',
  'MARKER_DS_STORE',
  'MARKER_ENV_SHEET',
  'MARKER_SET_ENV',
  'MARKER_SRC_ENV',
  'MARKER_ALIAS_ENV',
  ...(LINKS ? ['MARKER_LINKED_IMAGE'] : [])
]

// What a file's text reads as once a bundler inlines it in a data: URL.
const inlined = (text: string) =>
  Buffer.from(text).toString('base64').slice(0, 16)

async function build(app: string) {
  const {extensionBuild} = await import('../../command-build')
  const previous = process.env.VITEST

  process.env.VITEST = 'true'

  try {
    return (await extensionBuild(app, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)) as {errors_count: number; warnings?: string[]}
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function readDist(app: string) {
  const dist = path.join(app, 'dist', 'chrome')
  const emitted = (fs.readdirSync(dist, {recursive: true}) as string[]).filter(
    (entry) => fs.statSync(path.join(dist, entry)).isFile()
  )
  const shipped = emitted
    .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
    .join('\n')

  return {emitted, shipped}
}

const deadRefRequests = (warnings: string[] = []) =>
  warnings
    .map((warning) => /A url\((\S+)\) reference points/.exec(warning)?.[1])
    .filter(Boolean)
    .sort()

// A file that is there and withheld is told so, in words of its own.
const withheldRequests = (warnings: string[] = []) =>
  warnings
    .map((warning) => /(\S+) is not bundled\./.exec(warning)?.[1])
    .filter(Boolean)
    .sort()

const ALIAS_CONFIG = [
  "const path = require('path')",
  'module.exports = {',
  '  config: (config) => {',
  "    config.resolve.alias = {...config.resolve.alias, secretalias: path.join(__dirname, 'aliased')}",
  '    return config',
  '  }',
  '}',
  ''
].join('\n')

// A url() names a file, and the build ships no file under a private name or
// from outside the project, whichever sheet names it.
describe('a url() that names a file the build withholds, built', () => {
  it.each([
    ['a content script sheet', 'content'],
    ['a page sheet', 'page'],
    ['a sheet the manifest lists', 'listed']
  ] as Array<[string, Route]>)(
    '%s keeps the address as written and ships nothing for it',
    async (_label, folder) => {
      const root = makeProject({
        'app/package.json': JSON.stringify({
          private: true,
          name: 'withheld',
          version: '0.0.0'
        }),
        'app/manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'withheld',
          version: '1.0.0',
          action: {default_popup: 'page/popup.html'},
          content_scripts: [
            {
              matches: ['<all_urls>'],
              js: [`${folder}/scripts.js`],
              ...(folder === 'listed' ? {css: ['listed/styles.css']} : {})
            }
          ]
        }),
        'app/extension.config.js': ALIAS_CONFIG,
        [`app/${folder}/scripts.js`]:
          folder === 'content'
            ? "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n"
            : 'document.title = "x"\n',
        'app/page/popup.html': `<!doctype html>${folder === 'page' ? '<link rel="stylesheet" href="./styles.css">' : ''}<p>x</p>\n`,
        [`app/${folder}/styles.css`]: `${LINES.map((line) => line.css).join('\n')}\n`,
        [`app/${folder}/.env`]: 'MARKER_ENV=one\n',
        [`app/${folder}/.env.local`]: 'MARKER_LOCAL=two\n',
        [`app/${folder}/node_modules/pkg/.env`]: 'MARKER_PKG_ENV=three\n',
        [`app/${folder}/node_modules/pkg/img.png`]: 'ALLOWED_PKG_IMAGE\n',
        [`app/${folder}/.npmrc`]: 'MARKER_NPMRC=four\n',
        [`app/${folder}/.envrc`]: 'MARKER_ENVRC=five\n',
        [`app/${folder}/.git/config`]: 'MARKER_GIT_CONFIG\n',
        [`app/${folder}/.DS_Store`]: 'MARKER_DS_STORE\n',
        [`app/${folder}/.env.example`]: 'ALLOWED_ENV_TEMPLATE\n',
        [`app/${folder}/.env.css`]: 'MARKER_ENV_SHEET{}\n',
        [`app/${folder}/set/.env`]: 'MARKER_SET_ENV=six\n',
        [`app/${folder}/src/.env`]: 'MARKER_SRC_ENV=seven\n',
        'app/aliased/.env': 'MARKER_ALIAS_ENV=eight\n',
        'shared/outside.png': 'MARKER_SHARED_IMAGE\n',
        'linked.png': 'MARKER_LINKED_IMAGE\n'
      })
      const app = path.join(root, 'app')

      expectNoWorkspaceAbove(app)

      if (LINKS) {
        fs.symlinkSync(
          path.join(root, 'linked.png'),
          path.join(app, folder, 'linked.png')
        )
      }

      const summary = await build(app)
      const {emitted, shipped} = readDist(app)

      expect(summary.errors_count).toBe(0)
      // An env template documents the keys an env file holds, not their values.
      expect(emitted.filter((entry) => entry.includes('.env'))).toEqual([
        expect.stringMatching(/\.example$/)
      ])

      for (const marker of MARKERS) {
        expect(shipped).not.toContain(marker)
        expect(shipped).not.toContain(inlined(marker))
      }

      // The package image and the env template ship, inlined or as files.
      for (const allowed of ['ALLOWED_PKG_IMAGE', 'ALLOWED_ENV_TEMPLATE']) {
        expect(
          shipped.includes(allowed) || shipped.includes(inlined(allowed))
        ).toBe(true)
      }

      for (const {request} of LINES.filter((line) => line.kept)) {
        expect(shipped).toMatch(
          new RegExp(
            `url\\(\\\\?["']?${request.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\\\?["']?\\)`
          )
        )
      }

      expect(withheldRequests(summary.warnings)).toEqual(
        LINES.filter((line) => line.warns.includes(folder))
          .map((line) => line.request)
          .sort()
      )
    },
    120_000
  )

  // A sibling package of a workspace is the project's to name, a private
  // name in it never.
  it('a content script sheet ships a file of a sibling package in a workspace', async () => {
    const root = makeProject({
      'package.json': JSON.stringify({private: true, workspaces: ['*']}),
      'app/package.json': JSON.stringify({
        private: true,
        name: 'sibling',
        version: '0.0.0'
      }),
      'app/manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'sibling',
        version: '1.0.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      }),
      'app/content/scripts.js':
        "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n",
      'app/content/styles.css':
        '.a{background:url(../../shared/img.png)}\n.b{background:url(../../shared/.env)}\n',
      'shared/img.png': 'SIBLING_IMAGE\n',
      'shared/.env': 'MARKER_SIBLING_ENV=seven\n'
    })
    const app = path.join(root, 'app')
    const {extensionBuild} = await import('../../command-build')
    const previous = process.env.VITEST

    process.env.VITEST = 'true'

    let summary: {errors_count: number; warnings?: string[]}

    try {
      summary = (await extensionBuild(app, {
        browser: 'chrome',
        silent: true,
        install: false,
        mode: 'production',
        exitOnError: false
      } as never)) as typeof summary
    } finally {
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }

    const dist = path.join(app, 'dist', 'chrome')
    const shipped = (fs.readdirSync(dist, {recursive: true}) as string[])
      .filter((entry) => fs.statSync(path.join(dist, entry)).isFile())
      .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
      .join('\n')

    expect(summary.errors_count).toBe(0)
    expect(
      shipped.includes('SIBLING_IMAGE') ||
        shipped.includes(inlined('SIBLING_IMAGE'))
    ).toBe(true)

    expect(shipped).not.toContain('url(../../shared/img.png)')
    expect(shipped).not.toContain('MARKER_SIBLING_ENV')
    expect(shipped).not.toContain(inlined('MARKER_SIBLING_ENV'))
    expect(
      (summary.warnings ?? []).map(
        (warning) => /(\S+) is not bundled\./.exec(warning)?.[1]
      )
    ).toEqual(['../../shared/.env'])
  }, 120_000)

  // A component's block reaches the bundler as a sheet of its own, and a
  // name with no ./ ahead of it is a path there too.
  const FRAMEWORKS = {
    vue: workspacePackage('vue'),
    runtime: workspacePackage('@vue/runtime-dom'),
    svelte: workspacePackage('svelte'),
    svelteLoader: workspacePackage('svelte-loader')
  }

  it.each([
    ['Vue', 'App.vue', Boolean(FRAMEWORKS.vue && FRAMEWORKS.runtime)],
    [
      'Svelte',
      'Page.svelte',
      Boolean(FRAMEWORKS.svelte && FRAMEWORKS.svelteLoader)
    ]
  ])(
    'the style block of a %s page component ships nothing it withholds',
    async (label, component, installed) => {
      if (!installed) return

      const block = [
        '.a{background:url(.env)}',
        '.b{background:url(./.env.css)}',
        '.c{background:url(./ok.png)}',
        ''
      ].join('\n')
      const vue = label === 'Vue'
      const version = (dir: string) =>
        JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
          .version as string
      const root = makeProject({
        'app/package.json': JSON.stringify({
          private: true,
          name: 'withheld-block',
          version: '0.0.0',
          dependencies: vue
            ? {vue: version(FRAMEWORKS.vue as string)}
            : {svelte: version(FRAMEWORKS.svelte as string)}
        }),
        'app/manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'withheld-block',
          version: '1.0.0',
          action: {default_popup: 'popup.html'}
        }),
        'app/popup.html':
          '<!doctype html><p>x</p><script type="module" src="./popup.js"></script>\n',
        'app/popup.js': vue
          ? `import {createApp} from 'vue'\nimport App from './src/${component}'\ncreateApp(App).mount('body')\n`
          : `import {mount} from 'svelte'\nimport Page from './src/${component}'\nmount(Page, {target: document.body})\n`,
        [`app/src/${component}`]: vue
          ? `<script>\nexport default {render() { return null }}\n</script>\n<style>\n${block}</style>\n`
          : `<p class="a">x</p>\n<style>\n${block.replace(/^\.(\w)/gm, ':global(.$1)')}</style>\n`,
        'app/src/.env': 'MARKER_BLOCK_ENV=one\n',
        'app/src/.env.css': 'MARKER_BLOCK_SHEET{}\n',
        'app/src/ok.png': 'ALLOWED_BLOCK_IMAGE\n'
      })
      const app = path.join(root, 'app')
      const modules = path.join(app, 'node_modules')

      fs.mkdirSync(modules, {recursive: true})

      if (vue) {
        // vue-loader reads the runtime from the project, the way an install has it.
        fs.cpSync(FRAMEWORKS.vue as string, path.join(modules, 'vue'), {
          recursive: true,
          dereference: true
        })

        fs.symlinkSync(
          path.dirname(FRAMEWORKS.runtime as string),
          path.join(modules, '@vue'),
          'junction'
        )
      } else {
        fs.symlinkSync(
          FRAMEWORKS.svelte as string,
          path.join(modules, 'svelte'),
          'junction'
        )

        fs.symlinkSync(
          FRAMEWORKS.svelteLoader as string,
          path.join(modules, 'svelte-loader'),
          'junction'
        )
      }

      expectNoWorkspaceAbove(app)

      const summary = await build(app)
      const {shipped} = readDist(app)

      expect(summary.errors_count).toBe(0)

      for (const marker of ['MARKER_BLOCK_ENV', 'MARKER_BLOCK_SHEET']) {
        expect(shipped).not.toContain(marker)
        expect(shipped).not.toContain(inlined(marker))
      }

      expect(
        shipped.includes('ALLOWED_BLOCK_IMAGE') ||
          shipped.includes(inlined('ALLOWED_BLOCK_IMAGE'))
      ).toBe(true)

      expect(withheldRequests(summary.warnings)).toEqual(['./.env.css', '.env'])
    },
    120_000
  )

  // A page sheet a preprocessor compiles, or a CSS module a page script
  // imports, reaches the same check once the tool is done with it.
  const TOOLS = {
    sass: workspacePackage('sass'),
    less: workspacePackage('less')
  }

  // Less writes ./.env as .env before the bundler reads the sheet.
  it.each([
    ['a page .scss', 'styles.scss', TOOLS.sass && 'sass', ['./.env', '.env']],
    ['a page .less', 'styles.less', TOOLS.less && 'less', ['.env']],
    [
      'a .module.css a page script imports',
      'card.module.css',
      '',
      ['./.env', '.env']
    ]
  ] as Array<[string, string, string | undefined, string[]]>)(
    '%s keeps a private address as written and ships nothing for it',
    async (_label, sheet, tool, requests) => {
      if (tool === undefined) return

      const root = makeProject({
        'app/package.json': JSON.stringify({
          private: true,
          name: 'withheld-tool',
          version: '0.0.0',
          ...(tool ? {devDependencies: {[tool]: '*'}} : {})
        }),
        'app/manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'withheld-tool',
          version: '1.0.0',
          action: {default_popup: 'popup.html'}
        }),
        'app/popup.html':
          '<!doctype html><p>x</p><script type="module" src="./popup.js"></script>\n',
        'app/popup.js': sheet.includes('.module.')
          ? `import s from './src/${sheet}'\ndocument.title = s.a\n`
          : `import './src/${sheet}'\n`,
        [`app/src/${sheet}`]: [
          '.a{background:url(.env)}',
          '.b{background:url(./.env)}',
          '.c{background:url(./ok.png)}',
          ''
        ].join('\n'),
        'app/src/.env': 'MARKER_TOOL_ENV=one\n',
        'app/src/ok.png': 'ALLOWED_TOOL_IMAGE\n'
      })
      const app = path.join(root, 'app')

      if (tool) {
        fs.mkdirSync(path.join(app, 'node_modules'), {recursive: true})
        fs.symlinkSync(
          TOOLS[tool as 'sass' | 'less'] as string,
          path.join(app, 'node_modules', tool),
          'junction'
        )
      }

      expectNoWorkspaceAbove(app)

      const summary = await build(app)
      const {shipped} = readDist(app)

      expect(summary.errors_count).toBe(0)
      expect(shipped).not.toContain('MARKER_TOOL_ENV')
      expect(shipped).not.toContain(inlined('MARKER_TOOL_ENV'))
      expect(
        shipped.includes('ALLOWED_TOOL_IMAGE') ||
          shipped.includes(inlined('ALLOWED_TOOL_IMAGE'))
      ).toBe(true)

      for (const request of requests) {
        expect(shipped).toContain(`url(${request})`)
      }

      expect(withheldRequests(summary.warnings)).toEqual(requests)
    },
    120_000
  )

  // The text the bundler asks for need not be the text the sheet holds, and
  // the file it leads to is checked either way.
  it.each([
    ['a query and a fragment', 'url(.env?x#y)', '.env?x#y'],
    ['a ~ ahead of a package', 'url(~pkg/.env)', 'pkg/.env'],
    ['an escape in the name', 'url(".\\65 nv")', '.env'],
    ['a percent-encoded name', 'url(.%65nv)', '.env'],
    ['an @import', '@import "./.env.css";', './.env.css']
  ])(
    'a page sheet ships nothing it withholds when its url() holds %s',
    async (_label, css, request) => {
      const root = makeProject({
        'app/package.json': JSON.stringify({
          private: true,
          name: 'withheld-spelled',
          version: '0.0.0'
        }),
        'app/manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'withheld-spelled',
          version: '1.0.0',
          action: {default_popup: 'popup.html'}
        }),
        'app/popup.html':
          '<!doctype html><link rel="stylesheet" href="./styles.css"><p>x</p>\n',
        'app/styles.css': css.startsWith('@')
          ? `${css}\n.a{color:red}\n`
          : `.a{background:${css}}\n`,
        'app/.env': 'MARKER_SPELLED_ENV=one\n',
        'app/.env.css': '.MARKER_SPELLED_SHEET{color:red}\n',
        'app/node_modules/pkg/package.json': JSON.stringify({
          name: 'pkg',
          version: '1.0.0'
        }),
        'app/node_modules/pkg/.env': 'MARKER_SPELLED_PKG=one\n'
      })
      const app = path.join(root, 'app')

      expectNoWorkspaceAbove(app)

      const summary = await build(app)
      const {shipped} = readDist(app)

      expect(summary.errors_count).toBe(0)

      for (const marker of [
        'MARKER_SPELLED_ENV',
        'MARKER_SPELLED_SHEET',
        'MARKER_SPELLED_PKG'
      ]) {
        expect(shipped).not.toContain(marker)
        expect(shipped).not.toContain(inlined(marker))
      }

      expect(withheldRequests(summary.warnings)).toEqual([request])
    },
    120_000
  )
})

// A name with no file beside the sheet or in public/ is the resolver's to
// place, and an alias of the project's config can. What it leads to is
// checked like any other file.
describe('a page sheet url() an alias places, built', () => {
  const ALIASES = [
    "const path = require('path')",
    'module.exports = {',
    '  config: (config) => {',
    '    config.resolve.alias = {',
    '      ...config.resolve.alias,',
    "      aliased: path.join(__dirname, 'src/art'),",
    "      hidden: path.join(__dirname, 'src/.git'),",
    "      away: path.join(__dirname, '../shared')",
    '    }',
    '    return config',
    '  }',
    '}',
    ''
  ].join('\n')

  function aliasProject(css: string) {
    const root = makeProject({
      'app/package.json': JSON.stringify({
        private: true,
        name: 'aliased',
        version: '0.0.0'
      }),
      'app/manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'aliased',
        version: '1.0.0',
        action: {default_popup: 'popup/index.html'}
      }),
      'app/extension.config.js': ALIASES,
      'app/popup/index.html':
        '<!doctype html><link rel="stylesheet" href="./styles.css"><p>x</p>\n',
      'app/popup/styles.css': `${css}\n`,
      'app/src/art/logo.png': 'ALLOWED_ALIAS_LOGO\n',
      'app/src/.git/logo.png': 'MARKER_ALIAS_HIDDEN\n',
      'app/node_modules/pkg/package.json': JSON.stringify({
        name: 'pkg',
        version: '1.0.0'
      }),
      'app/node_modules/pkg/img.png': 'ALLOWED_PACKAGE_LOGO\n',
      'shared/logo.png': 'MARKER_ALIAS_OUTSIDE\n'
    })
    const app = path.join(root, 'app')

    expectNoWorkspaceAbove(app)

    return app
  }

  const ships = (shipped: string, text: string) =>
    shipped.includes(text) || shipped.includes(inlined(text))

  it.each([
    ['an alias to an image inside', 'aliased/logo.png', 'ALLOWED_ALIAS_LOGO'],
    ['an installed package', 'pkg/img.png', 'ALLOWED_PACKAGE_LOGO']
  ])(
    'a bare name %s places ships with no warning',
    async (_l, name, text) => {
      const app = aliasProject(`.a{background:url(${name})}`)
      const summary = await build(app)
      const {shipped} = readDist(app)

      expect(summary.errors_count).toBe(0)
      expect(ships(shipped, text)).toBe(true)
      expect(deadRefRequests(summary.warnings)).toEqual([])
      expect(withheldRequests(summary.warnings)).toEqual([])
    },
    120_000
  )

  it.each([
    ['a private folder', 'hidden/logo.png', 'MARKER_ALIAS_HIDDEN'],
    ['outside the project', 'away/logo.png', 'MARKER_ALIAS_OUTSIDE']
  ])(
    'an alias to %s ships nothing and warns',
    async (_l, name, marker) => {
      const app = aliasProject(`.a{background:url(${name})}`)
      const summary = await build(app)
      const {shipped} = readDist(app)

      expect(summary.errors_count).toBe(0)
      expect(ships(shipped, marker)).toBe(false)
      expect(shipped).toContain(`url(${name})`)
      expect(withheldRequests(summary.warnings)).toEqual([name])
    },
    120_000
  )

  it('a bare name nothing places warns once and the build passes', async () => {
    const app = aliasProject(
      '.a{background:url(nowhere/logo.png)}\n.b{background:url(nowhere/logo.png)}'
    )
    const summary = await build(app)

    expect(summary.errors_count).toBe(0)
    expect(deadRefRequests(summary.warnings)).toEqual(['nowhere/logo.png'])
  }, 120_000)

  it('strict refs makes a bare name nothing places an error', async () => {
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')

    const app = aliasProject('.a{background:url(nowhere/logo.png)}')
    const failure = (await build(app).catch((error) => error)) as {
      diagnostics?: Array<{severity: string; name?: string; message: string}>
    }
    const errors = (failure.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.severity === 'error'
    )

    expect(errors.map((error) => error.message.split('\n')[0])).toEqual([
      expect.stringContaining('url(nowhere/logo.png)')
    ])
  }, 120_000)

  it('strict refs leaves a name an alias places alone', async () => {
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')

    const app = aliasProject('.a{background:url(aliased/logo.png)}')
    const summary = await build(app)
    const {shipped} = readDist(app)

    expect(summary.errors_count).toBe(0)
    expect(ships(shipped, 'ALLOWED_ALIAS_LOGO')).toBe(true)
  }, 120_000)
})
