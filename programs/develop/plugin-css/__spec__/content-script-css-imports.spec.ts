import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {cssInContentScriptLoader} from '../css-in-content-script-loader'
import {bundledFileToken} from '../css-lib/inline-content-script-css'
import {inlineCssImports, whyNotRead} from '../css-lib/inline-css-imports'
import deadCssUrlLoader from '../dead-css-url-loader'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()
const WARN = '⏵⏵⏵'
const BOM = String.fromCharCode(0xfeff)

afterEach(() => {
  vi.unstubAllEnvs()
})

function inline(root: string, sheet: string) {
  const resourcePath = path.join(root, sheet)

  return inlineCssImports(fs.readFileSync(resourcePath, 'utf8'), {
    resourcePath,
    roots: [path.join(root, 'public'), root],
    projectPath: root
  })
}

// A content-script sheet reaches the page as a data: URL. A relative @import
// has no base there, so the browser fetches nothing and the rules are lost.
describe('the sheets a content-script sheet imports', () => {
  it('come in where the @import stood, in order', () => {
    const root = makeProject({
      'content/styles.css':
        '@import "./reset.css";\n@import url(./theme.css);\n.own{color:red}\n',
      'content/reset.css': '.reset{margin:0}\n',
      'content/theme.css': '.theme{color:blue}\n'
    })

    expect(inline(root, 'content/styles.css')).toEqual({
      css: '.reset{margin:0}\n\n.theme{color:blue}\n\n.own{color:red}\n',
      files: [
        path.join(root, 'content', 'reset.css'),
        path.join(root, 'content', 'theme.css')
      ],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      answered: [],
      cycles: []
    })
  })

  it('keep the conditions the @import carried', () => {
    const root = makeProject({
      'styles.css': [
        '@import "./print.css" print;',
        '@import "./grid.css" supports(display: grid) screen and (min-width: 40em);',
        '@import "./base.css" layer(base);',
        '@import "./anon.css" layer;',
        ''
      ].join('\n'),
      'print.css': '.p{}',
      'grid.css': '.g{}',
      'base.css': '.b{}',
      'anon.css': '.n{}'
    })

    expect(inline(root, 'styles.css').css).toBe(
      [
        '@media print {\n.p{}\n}',
        '@supports (display: grid) {\n@media screen and (min-width: 40em) {\n.g{}\n}\n}',
        '@layer base {\n.b{}\n}',
        '@layer {\n.n{}\n}',
        ''
      ].join('\n')
    )
  })

  it('bring in what they import, with each url() named from the first sheet', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/buttons.css";\n',
      'shared/buttons.css':
        '@import "./parts/icons.css";\n.button{background:url(img/bg.png)}\n',
      'shared/parts/icons.css':
        '.icon{background:url("./icon.svg#mark")}\n.remote{background:url(https://example.com/a.png)}\n.root{background:url(/img/root.png)}\n'
    })

    expect(inline(root, 'content/styles.css').css).toBe(
      [
        '.icon{background:url("../shared/parts/icon.svg#mark")}',
        '.remote{background:url(https://example.com/a.png)}',
        '.root{background:url(/img/root.png)}',
        '',
        '.button{background:url(../shared/img/bg.png)}',
        '',
        ''
      ].join('\n')
    )
  })

  it('are found from the public folder for a root path, and with .css left off', () => {
    const root = makeProject({
      'content/styles.css': '@import "/css/tokens.css";\n@import "./theme";\n',
      'public/css/tokens.css': ':root{--a:1}',
      'content/theme.css': '.theme{}'
    })

    expect(inline(root, 'content/styles.css').css).toBe(
      ':root{--a:1}\n.theme{}\n'
    )
  })

  it('come in once when two sheets import each other', () => {
    const root = makeProject({
      'a.css': '@import "./b.css";\n.a{}\n',
      'b.css': '@import "./a.css";\n.b{}\n'
    })

    const result = inline(root, 'a.css')

    expect(result.css).toBe('\n.b{}\n\n.a{}\n')
    expect(result.cycles).toEqual([
      [
        path.join(root, 'a.css'),
        path.join(root, 'b.css'),
        path.join(root, 'a.css')
      ]
    ])
  })

  // A url( in a string or a comment names no file, and a name can also sit
  // in a plain string where a function takes one.
  it('name each address from the first sheet, and leave text that only reads like one', () => {
    const root = makeProject({
      'styles.css': '@import "./sub/a.css";\n',
      'sub/a.css': [
        '.note::after{content:"see url(a.png)"}',
        '/* url(./in-comment.png) */',
        '@font-face{font-family:A;src:url(./a.woff2) format("woff2"),url(\'a.woff\')}',
        '.set{background:image-set("./a.png" 1x, url(b.png) 2x)}',
        '.set{background:-webkit-image-set( "c.png" 1x)}',
        ':root{--icon: url( ./icon.svg#mark )}',
        '.data{background:url(data:image/png;base64,AAAA)}',
        '.attr[title="url(a.png)"]{color:red}',
        ''
      ].join('\n')
    })

    expect(inline(root, 'styles.css').css).toBe(
      [
        '.note::after{content:"see url(a.png)"}',
        '/* url(./in-comment.png) */',
        '@font-face{font-family:A;src:url(./sub/a.woff2) format("woff2"),url(\'./sub/a.woff\')}',
        '.set{background:image-set("./sub/a.png" 1x, url(./sub/b.png) 2x)}',
        '.set{background:-webkit-image-set( "./sub/c.png" 1x)}',
        ':root{--icon: url( ./sub/icon.svg#mark )}',
        '.data{background:url(data:image/png;base64,AAAA)}',
        '.attr[title="url(a.png)"]{color:red}',
        '',
        ''
      ].join('\n')
    )
  })

  it('leave a sheet that sets an @namespace where it is, with the reason', () => {
    const root = makeProject({
      'styles.css': '@import "./svg.css";\n.own{}\n',
      'svg.css':
        '@namespace svg url(http://www.w3.org/2000/svg);\n@import "./more.css";\nsvg|a{}\n',
      'more.css': '.more{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: '@import "./svg.css";\n.own{}\n',
      files: [],
      missing: [],
      unreadable: [
        {
          request: './svg.css',
          file: path.join(root, 'svg.css'),
          from: path.join(root, 'styles.css'),
          reason:
            'The file sets an @namespace, which reads differently once its rules sit in another stylesheet.',
          fix: 'Import that file from the script instead, or move its @namespace rules out of it.'
        }
      ],
      moved: [],
      skipped: [],
      answered: [path.join(root, 'svg.css')],
      cycles: []
    })
  })

  it('bring nothing into a sheet that sets an @namespace of its own', () => {
    const source =
      '@import "./a.css";\n@import "./b.css";\n@namespace svg url(http://www.w3.org/2000/svg);\nsvg|a{}\n'
    const root = makeProject({
      'styles.css': source,
      'a.css': '.a{}\n',
      'b.css': '.b{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(source)
    expect(result.files).toEqual([])
    expect(result.unreadable).toEqual(
      ['a', 'b'].map((name) => ({
        request: `./${name}.css`,
        file: path.join(root, `${name}.css`),
        from: path.join(root, 'styles.css'),
        reason:
          'This stylesheet sets an @namespace, which has to come before every rule, so no imported rules can come in ahead of it.',
        fix: 'Import that file from the script instead, or move the @namespace rules to a sheet of their own.'
      }))
    )
  })

  // A sheet a package ships is as much the project's as one it wrote, and a
  // folder that starts with a dot is a folder like any other.
  it.each([
    ['in node_modules of the project', './node_modules/pkg/x.css'],
    ['in node_modules of a folder above', '../node_modules/up/x.css'],
    ['in a folder that starts with a dot', './.well-known/x.css']
  ])('bring in a sheet %s', (_label, request) => {
    const root = makeProject({
      'app/styles.css': `@import "${request}";\n.own{}\n`,
      'app/node_modules/pkg/x.css': '.x{}\n',
      'node_modules/up/x.css': '.x{}\n',
      'app/.well-known/x.css': '.x{}\n'
    })
    const app = path.join(root, 'app')
    const result = inlineCssImports(
      fs.readFileSync(path.join(app, 'styles.css'), 'utf8'),
      {
        resourcePath: path.join(app, 'styles.css'),
        roots: [path.join(app, 'public'), app],
        projectPath: app
      }
    )

    expect(result.css).toBe('.x{}\n\n.own{}\n')
    expect(result.files).toEqual([path.resolve(app, request)])
    expect(result.unreadable).toEqual([])
  })

  const KEEP =
    'Keep the sheets a content script stylesheet imports inside the project or its workspace, or in a package it installs.'
  const NO_PRIVATE_NAME =
    'Give the sheet a path with no private file or folder name along it.'

  function inlineApp(root: string) {
    const app = path.join(root, 'app')

    return inlineCssImports(
      fs.readFileSync(path.join(app, 'styles.css'), 'utf8'),
      {
        resourcePath: path.join(app, 'styles.css'),
        roots: [path.join(app, 'public'), app],
        projectPath: app
      }
    )
  }

  // With no workspace file above, the folder beside the project is not its own.
  it('leave a sheet outside the project where it is, and name where it sits', () => {
    const root = makeProject({
      'shared/tokens.css': '.tokens{}\n',
      'app/styles.css':
        '@import "../shared/tokens.css";\n@import "./ok.css";\n.own{}\n',
      'app/ok.css': '.ok{}\n'
    })
    const result = inlineApp(root)
    const real = fs.realpathSync(path.join(root, 'shared', 'tokens.css'))

    expect(result.css).toBe(
      '@import "../shared/tokens.css";\n.ok{}\n\n.own{}\n'
    )

    expect(result.unreadable).toEqual([
      {
        request: '../shared/tokens.css',
        file: path.join(root, 'shared', 'tokens.css'),
        from: path.join(root, 'app', 'styles.css'),
        reason: `The file sits outside the project, at ${real.split(path.sep).join('/')}.`,
        fix: KEEP
      }
    ])
  })

  // A workspace is a folder above that pnpm, npm, Yarn or Bun read as one.
  it.each([
    ['a pnpm-workspace.yaml', {'pnpm-workspace.yaml': "packages:\n  - '*'\n"}],
    [
      'a package.json with a workspaces list',
      {'package.json': JSON.stringify({private: true, workspaces: ['*']})}
    ],
    [
      'a package.json with workspaces packages',
      {
        'package.json': JSON.stringify({
          private: true,
          workspaces: {packages: ['*']}
        })
      }
    ]
  ])('bring in a sheet of a sibling package under %s', (_label, marker) => {
    const root = makeProject({
      ...marker,
      'shared/tokens.css': '.tokens{}\n',
      'app/styles.css': '@import "../shared/tokens.css";\n.own{}\n'
    })
    const result = inlineApp(root)

    expect(result.css).toBe('.tokens{}\n\n.own{}\n')
    expect(result.unreadable).toEqual([])
  })

  it.each([
    ['a lockfile', {'pnpm-lock.yaml': "lockfileVersion: '9.0'\n"}],
    ['an npm lockfile', {'package-lock.json': '{}'}],
    ['a .git folder', {'.git/HEAD': 'ref: refs/heads/main\n'}],
    ['a turbo.json', {'turbo.json': '{}'}],
    [
      'a workspaces field that is a string',
      {'package.json': '{"workspaces":"*"}'}
    ]
  ])('leave a sibling sheet out when the folder above has only %s', (_label, marker) => {
    const root = makeProject({
      ...marker,
      'shared/tokens.css': '.tokens{}\n',
      'app/styles.css': '@import "../shared/tokens.css";\n.own{}\n'
    })
    const real = fs.realpathSync(path.join(root, 'shared', 'tokens.css'))

    expect(inlineApp(root).unreadable.map((left) => left.reason)).toEqual([
      `The file sits outside the project, at ${real.split(path.sep).join('/')}.`
    ])
  })

  it.each([
    [
      'a private name',
      '../shared/.env/x.css',
      'The path holds .env, a name the build keeps private.'
    ],
    [
      'the node_modules of another package',
      '../shared/node_modules/pkg/x.css',
      'outside'
    ],
    ['a dot-folder a tool keeps', '../shared/.cache/x.css', 'outside'],
    ['a dot-folder at the workspace root', '../.turbo/x.css', 'outside']
  ])('leave a workspace sheet out whose path holds %s', (_label, request, why) => {
    const root = makeProject({
      'pnpm-workspace.yaml': "packages:\n  - '*'\n",
      [path.posix.join('app', request)]: '.x{}\n',
      'app/styles.css': `@import "${request}";\n.own{}\n`
    })
    const real = fs.realpathSync(path.join(root, 'app', request))
    const reason =
      why === 'outside'
        ? `The file sits outside the project, at ${real.split(path.sep).join('/')}.`
        : why

    expect(inlineApp(root).unreadable.map((left) => left.reason)).toEqual([
      reason
    ])
  })

  it.each([
    ['an env file a package holds', './node_modules/pkg/.env', '.env'],
    ['an env file for one mode', './.env.local', '.env.local'],
    ['a sheet inside .git', './.git/x.css', '.git'],
    ['a sheet inside a folder named as an env file', './.env/x.css', '.env'],
    [
      'a sheet a package keeps in .git',
      './node_modules/pkg/.git/x.css',
      '.git'
    ],
    ['the settings of the package manager', './.npmrc', '.npmrc'],
    ['a file the desktop wrote', './.DS_Store', '.DS_Store']
  ])('leave %s where it is, by its name', (_label, request, name) => {
    const root = makeProject({
      'app/styles.css': `@import "${request}";\n@import "./ok.css";\n.own{}\n`,
      'app/ok.css': '.ok{}\n',
      'app/node_modules/pkg/.env': '.secret{}\n',
      'app/node_modules/pkg/.git/x.css': '.x{}\n',
      'app/.env.local': '.secret{}\n',
      'app/.git/x.css': '.x{}\n',
      'app/.env/x.css': '.x{}\n',
      'app/.npmrc': '.secret{}\n',
      'app/.DS_Store': '.secret{}\n'
    })
    const result = inlineApp(root)

    expect(result.css).toBe(`@import "${request}";\n.ok{}\n\n.own{}\n`)
    expect(result.files).toEqual([path.join(root, 'app', 'ok.css')])
    expect(result.unreadable).toEqual([
      {
        request,
        file: path.resolve(root, 'app', request),
        from: path.join(root, 'app', 'styles.css'),
        reason: `The path holds ${name}, a name the build keeps private.`,
        fix: NO_PRIVATE_NAME
      }
    ])
  })

  // A disk that ignores letter case opens the project under any spelling.
  it.skipIf(!fs.existsSync(__filename.toUpperCase()))(
    'bring a sheet in when the project path is spelled in another letter case',
    () => {
      const root = makeProject({
        'App/styles.css': '@import "./ok.css";\n.own{}\n',
        'App/ok.css': '.ok{}\n'
      })
      const app = path.join(root, 'App')
      const result = inlineCssImports(
        fs.readFileSync(path.join(app, 'styles.css'), 'utf8'),
        {
          resourcePath: path.join(app, 'styles.css'),
          roots: [app],
          projectPath: path.join(root, 'app').toLowerCase()
        }
      )

      expect(result.css).toBe('.ok{}\n\n.own{}\n')
      expect(result.unreadable).toEqual([])
    }
  )

  // A template documents the keys of an env file and holds no value.
  it('bring in a sheet from a folder named as an env template', () => {
    const root = makeProject({
      'app/styles.css': '@import "./.env.example/x.css";\n.own{}\n',
      'app/.env.example/x.css': '.x{}\n'
    })

    expect(inlineApp(root).css).toBe('.x{}\n\n.own{}\n')
  })

  // Windows asks for a privilege to make a link, so these run where it is free.
  describe.skipIf(process.platform === 'win32')('through a link', () => {
    it('leave a sheet whose real file is outside the project', () => {
      const root = makeProject({
        'outside.css': '.outside{}\n',
        'app/styles.css': '@import "./linked.css";\n.own{}\n'
      })
      const app = path.join(root, 'app')

      fs.symlinkSync(
        path.join(root, 'outside.css'),
        path.join(app, 'linked.css')
      )

      const result = inlineApp(root)
      const real = fs.realpathSync(path.join(root, 'outside.css'))

      expect(result.css).toBe('@import "./linked.css";\n.own{}\n')
      expect(result.unreadable.map((left) => left.reason)).toEqual([
        `The file sits outside the project, at ${real}.`
      ])
    })

    // A package manager links each package into a store it keeps.
    it.each([
      ['of the project', 'app'],
      ['of a folder above it', '.']
    ])('bring in a sheet a package links into the store %s', (_label, owner) => {
      const root = makeProject({
        'app/styles.css': '@import "./node_modules/pkg/x.css";\n.own{}\n',
        [`${owner}/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/x.css`]:
          '.x{}\n'
      })
      const modules = path.join(root, 'app', 'node_modules')

      fs.mkdirSync(modules, {recursive: true})
      fs.symlinkSync(
        path.join(root, owner, 'node_modules/.pnpm/pkg@1.0.0/node_modules/pkg'),
        path.join(modules, 'pkg'),
        'dir'
      )

      const result = inlineApp(root)

      expect(result.css).toBe('.x{}\n\n.own{}\n')
      expect(result.unreadable).toEqual([])
    })

    // A package is asked for by its path in node_modules, not by a link.
    it('leave a sheet a link in the project takes into node_modules above', () => {
      const root = makeProject({
        'app/styles.css': '@import "./linked.css";\n.own{}\n',
        'node_modules/up/x.css': '.x{}\n'
      })

      fs.symlinkSync(
        path.join(root, 'node_modules', 'up', 'x.css'),
        path.join(root, 'app', 'linked.css')
      )

      const real = fs.realpathSync(path.join(root, 'node_modules/up/x.css'))

      expect(inlineApp(root).unreadable.map((left) => left.reason)).toEqual([
        `The file sits outside the project, at ${real}.`
      ])
    })

    it('leave a sheet a link takes to a private name', () => {
      const root = makeProject({
        'app/styles.css': '@import "./theme.css";\n.own{}\n',
        'app/.git/x.css': '.x{}\n'
      })

      fs.symlinkSync(
        path.join(root, 'app', '.git', 'x.css'),
        path.join(root, 'app', 'theme.css')
      )

      expect(inlineApp(root).unreadable.map((left) => left.reason)).toEqual([
        'The path holds .git, a name the build keeps private.'
      ])
    })

    it('bring a sheet in once when a folder links back to itself', () => {
      const root = makeProject({
        'styles.css': '@import "./a.css";\n.own{}\n',
        'a.css': '@import "./loop/a.css";\n.a{}\n'
      })

      fs.symlinkSync(root, path.join(root, 'loop'), 'dir')

      const result = inline(root, 'styles.css')

      expect(result.css).toBe('\n.a{}\n\n.own{}\n')
      expect(result.cycles).toEqual([
        [path.join(root, 'a.css'), path.join(root, 'a.css')]
      ])
    })
  })

  // CSS reads a name with no ./ ahead of it from the folder of its sheet, and
  // the bundler looks there before it looks for a package.
  it('read a name with no ./ ahead of it as the file beside the sheet that has exactly that name', () => {
    const root = makeProject({
      'styles.css':
        '@import "reset.css";\n@import "parts/a.css" print;\n.own{}\n',
      'reset.css': '.reset{}\n',
      'parts/a.css': '.a{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: '.reset{}\n\n@media print {\n.a{}\n\n}\n.own{}\n',
      files: [path.join(root, 'reset.css'), path.join(root, 'parts', 'a.css')],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      answered: [],
      cycles: []
    })
  })

  it('read such a name the same way in a sheet that came in, from that sheet', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css': '@import "x.css";\n.a{}\n',
      'shared/x.css': '.x{background:url(./x.png)}\n',
      // The one beside the first sheet is not the one the second names.
      'content/x.css': '.wrong{}\n'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe(
      '.x{background:url(../shared/x.png)}\n\n.a{}\n\n.own{}\n'
    )

    expect(result.files).toEqual([
      path.join(root, 'shared', 'x.css'),
      path.join(root, 'shared', 'a.css')
    ])
  })

  it('write such a name as a path when its file stays out of a sheet that came in', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css': '@import "x.css";\n.a{}\n',
      'shared/x.css':
        '@namespace svg url(http://www.w3.org/2000/svg);\nsvg|a{}\n'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe('@import "../shared/x.css";\n.a{}\n\n.own{}\n')
    expect(result.unreadable.map((left) => left.request)).toEqual(['x.css'])
  })

  // A file with no .css ending is no sheet, so the name stays the package.
  it('read a name with no .css ending as a package, whatever file has that name', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css': '@import "tailwindcss";\n.a{}\n',
      'shared/tailwindcss': 'not a sheet\n'
    })

    expect(inline(root, 'content/styles.css').css).toBe(
      '@import "tailwindcss";\n\n.a{}\n\n.own{}\n'
    )
  })

  // No ending is guessed, the way no tool guesses one for a package.
  it('read a name with no ending as a package, with that name and .css beside', () => {
    const root = makeProject({
      'content/styles.css': '@import "reset";\n.own{}\n',
      'content/reset.css': '.reset{}\n'
    })

    expect(inline(root, 'content/styles.css').css).toBe(
      '@import "reset";\n.own{}\n'
    )
  })

  // The disk root is above every project and owns none of them.
  it('leave a sheet in the node_modules of the disk root', () => {
    const root = makeProject({'styles.css': '.own{}\n'})
    const file = path.resolve('/node_modules/pkg/x.css')

    expect(whyNotRead(file, root)?.reason).toBe(
      `The file sits outside the project, at ${file.split(path.sep).join('/')}.`
    )
  })

  it.skipIf(process.platform !== 'win32')(
    'bring in a package sheet when the drive letter is spelled in another case',
    () => {
      const root = makeProject({
        'app/styles.css': '.own{}\n',
        'node_modules/pkg/x.css': '.x{}\n'
      })
      const file = path.join(root, 'node_modules', 'pkg', 'x.css')
      const flipped =
        file[0] === file[0].toLowerCase()
          ? file[0].toUpperCase() + file.slice(1)
          : file[0].toLowerCase() + file.slice(1)

      expect(whyNotRead(flipped, path.join(root, 'app'))).toBeUndefined()
    }
  )

  // The same on every disk, one that ignores letter case included.
  it('read a name that differs from the file beside the sheet in letter case as a package', () => {
    const source = '@import "Reset.css";\n@import "Parts/a.css";\n.own{}\n'
    const root = makeProject({
      'styles.css': source,
      'reset.css': '.reset{}\n',
      'parts/a.css': '.a{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(source)
    expect(result.files).toEqual([])
  })

  // `tailwindcss` is not `tailwindcss.css`, so the file beside the sheet is
  // not what the name asks for.
  it('read a name no file beside the sheet has exactly as a package', () => {
    const source = '@import "tailwindcss";\n.own{}\n'
    const root = makeProject({
      'styles.css': source,
      'tailwindcss.css': '.local{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: source,
      files: [],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      answered: [],
      cycles: []
    })
  })

  // Whether a plugin brings it in is known once the tools ran, and writing
  // the file is awaited.
  it('leave a name ending in .css that no file has as written, and await the file', () => {
    const source = '@import "nope.css";\n.own{}\n'
    const root = makeProject({'styles.css': source})
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(source)
    expect(result.missing).toEqual([path.join(root, 'nope.css')])
  })

  // An @import that follows a rule is skipped by the browser and by the
  // tools, so each one that stays leads the sheet the others came into.
  it('move an import that stays to the head of the sheet', () => {
    const root = makeProject({
      'styles.css':
        '@import "./local.css";\n@import url(https://fonts.example.com/css?family=A);\n@import "tailwindcss";\n.own{}\n',
      'local.css': '@import "https://example.com/nested.css";\n.local{}\n'
    })

    expect(inline(root, 'styles.css').css).toBe(
      [
        '@import "https://example.com/nested.css";',
        '@import url(https://fonts.example.com/css?family=A);',
        '@import "tailwindcss";',
        '',
        '.local{}',
        '',
        '',
        '',
        '.own{}',
        ''
      ].join('\n')
    )
  })

  it('say which import now leads rules it used to follow', () => {
    const root = makeProject({
      'styles.css':
        '@import "https://example.com/first.css";\n@import "./local.css";\n@import "tailwindcss";\n.own{}\n',
      'local.css': '.local{}\n'
    })

    expect(inline(root, 'styles.css').moved).toEqual([
      {
        statement: '@import "tailwindcss";',
        file: path.join(root, 'styles.css')
      }
    ])
  })

  // The parser drops the mark and counts every place from the text after it.
  it.each([
    ['in the order of the file', BOM],
    ['in the other order', String.fromCharCode(0xfffe)]
  ])('come in whole when the sheet opens with a byte order mark %s', (_label, mark) => {
    const root = makeProject({
      'styles.css': `${mark}@import "./a.css";\n.own{}\n`,
      'a.css': `${mark}.a{}\n`
    })

    expect(inline(root, 'styles.css').css).toBe('.a{}\n\n.own{}\n')
  })

  it('come in whole when the lines end in a carriage return and a line feed', () => {
    const root = makeProject({
      'styles.css':
        '@import "./a.css";\r\n@import "https://example.com/x.css";\r\n.own{}\r\n',
      'a.css': '@import "./b.css";\r\n.a{}\r\n',
      'b.css': '.b{}\r\n'
    })

    expect(inline(root, 'styles.css').css).toBe(
      '@import "https://example.com/x.css";\n.b{}\r\n\r\n.a{}\r\n\r\n\r\n.own{}\r\n'
    )
  })

  // An import that stays is never dropped: it leads the sheet under the
  // conditions of the imports that brought its own sheet in.
  it('keep an import that stays, under the condition its sheet came in with', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css" screen;\n',
      'a.css': '@import "./b.css";\n',
      'b.css':
        '@import "https://fonts.example.com/x.css";\n@import "./gone.css";\n.b{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: [
        '@import "https://fonts.example.com/x.css" screen;',
        '@import "./gone.css" screen;',
        '@media screen {',
        '\n\n.b{}\n\n',
        '}',
        ''
      ].join('\n'),
      files: [path.join(root, 'b.css'), path.join(root, 'a.css')],
      missing: [path.join(root, 'gone.css')],
      unreadable: [],
      moved: [],
      skipped: [],
      answered: [],
      cycles: []
    })
  })

  it.each([
    [
      'a media query and a feature',
      'screen',
      '(min-width: 600px)',
      'screen and (min-width: 600px)'
    ],
    [
      'two supports conditions',
      'supports(display: grid)',
      'supports(not (display: flex))',
      'supports((display: grid) and (not (display: flex)))'
    ],
    [
      'a layer inside a layer',
      'layer(base)',
      'layer(fonts)',
      'layer(base.fonts)'
    ],
    [
      'every kind at once',
      'layer(base) supports(display: grid) print',
      '(orientation: landscape)',
      'layer(base) supports(display: grid) print and (orientation: landscape)'
    ]
  ])('join %s on an import that stays', (_label, outer, own, joined) => {
    const root = makeProject({
      'styles.css': `@import "./a.css" ${outer};\n`,
      'a.css': `@import url(https://example.com/x.css) ${own};\n.a{}\n`
    })
    const result = inline(root, 'styles.css')

    expect(result.css.split('\n')[0]).toBe(
      `@import "https://example.com/x.css" ${joined};`
    )

    expect(result.css).not.toContain('url(https://example.com/x.css)')
    expect(result.skipped).toEqual([])
  })

  it.each([
    ['an unnamed layer', 'layer', 'layer(fonts)', 'unnamed-layer'],
    [
      'an unnamed layer of its own inside a named one',
      'layer(a)',
      'layer',
      'unnamed-layer'
    ],
    [
      'two lists of media queries',
      'screen, print',
      '(min-width: 600px)',
      'media-not-joined'
    ],
    [
      'a query that opens with not',
      'not screen',
      '(min-width: 600px)',
      'media-not-joined'
    ],
    [
      'features joined by or',
      '(hover) or (pointer)',
      'screen',
      'media-not-joined'
    ],
    [
      'one type with two sets of features',
      'screen and (hover)',
      'screen and (pointer)',
      'media-not-joined'
    ],
    ['two media types', 'screen', 'print', 'media-never'],
    [
      'a function CSS does not define',
      'screen',
      'theme(reference)',
      'unknown-function'
    ]
  ])('leave an import in place, and say so, under %s', (_label, outer, own, why) => {
    const root = makeProject({
      'styles.css': `@import "./a.css" ${outer};\n.own{}\n`,
      'a.css': `@import "https://example.com/x.css" ${own};\n.a{}\n`
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toContain(
      `{\n@import "https://example.com/x.css" ${own};\n.a{}\n\n}`
    )

    expect(result.skipped).toEqual([
      {
        statement: `@import "https://example.com/x.css" ${own};`,
        file: path.join(root, 'a.css'),
        why
      }
    ])

    expect(result.moved).toEqual([])
  })

  it('say an import it cannot read the target of has none, under a condition', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css" screen;\n.own{}\n',
      'a.css': '@import nothing;\n.a{}\n'
    })

    expect(inline(root, 'styles.css').skipped).toEqual([
      {
        statement: '@import nothing;',
        file: path.join(root, 'a.css'),
        why: 'no-target'
      }
    ])
  })

  // `all` asks for every device, so the other type is the whole answer.
  it.each([
    ['all', 'print', 'print'],
    ['print', 'all', 'print'],
    ['all', '(min-width: 600px)', 'all and (min-width: 600px)'],
    ['all', 'all', 'all']
  ])('join %s with %s as %s', (outer, own, joined) => {
    const root = makeProject({
      'styles.css': `@import "./a.css" ${outer};\n.own{}\n`,
      'a.css': `@import "https://example.com/x.css" ${own};\n.a{}\n`
    })
    const result = inline(root, 'styles.css')

    expect(result.css.split('\n')[0]).toBe(
      `@import "https://example.com/x.css" ${joined};`
    )

    expect(result.skipped).toEqual([])
  })

  // One loop, met once from each of the two sheets the first one imports.
  it('tell a loop two imports of the first sheet lead into once', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css";\n@import "./b.css";\n.own{}\n',
      'a.css': '@import "./b.css";\n.a{}\n',
      'b.css': '@import "./a.css";\n.b{}\n'
    })

    expect(inline(root, 'styles.css').cycles).toEqual([
      [
        path.join(root, 'a.css'),
        path.join(root, 'b.css'),
        path.join(root, 'a.css')
      ]
    ])
  })

  // url() takes an address, and an address with no ./ is still a path.
  it('read a name inside url() as a path, whatever sits in node_modules', () => {
    const root = makeProject({
      'content/styles.css':
        '@import url(reset.css);\n@import url("../shared/a.css");\n@import url(gone.css);\n.own{}\n',
      'content/reset.css': '.reset{}\n',
      'shared/a.css': '@import url(x.css);\n@import url(late.css);\n.a{}\n',
      'shared/x.css': '.x{}\n',
      'node_modules/gone.css/index.css': '.pkg{}\n'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe(
      '@import "../shared/late.css";\n@import url(gone.css);\n.reset{}\n\n.x{}\n\n\n.a{}\n\n\n.own{}\n'
    )

    expect(result.missing).toEqual([
      path.join(root, 'shared', 'late.css'),
      path.join(root, 'content', 'gone.css')
    ])
  })

  it('read the addresses that follow a backslash ahead of a line break in a string', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n',
      'shared/a.css': '.a{content:"a\\\r\nb"}\n.z{background:url("./z.png")}\n'
    })

    expect(inline(root, 'content/styles.css').css).toContain(
      'url("../shared/z.png")'
    )
  })

  it.each([
    [
      'a range',
      '(400px <= width <= 700px)',
      'screen',
      'screen and (400px <= width <= 700px)'
    ],
    [
      'only and a type',
      'only screen',
      '(min-width: 600px)',
      'only screen and (min-width: 600px)'
    ],
    ['the same type twice', 'screen', 'screen', 'screen'],
    [
      'math in a feature',
      '(min-width: calc(10px + 2em))',
      '(max-width: max(600px, 50vw))',
      '(min-width: calc(10px + 2em)) and (max-width: max(600px, 50vw))'
    ],
    [
      'selector() in supports',
      'supports(selector(:has(a)))',
      'supports(display: grid)',
      'supports((selector(:has(a))) and (display: grid))'
    ],
    ['an outer layer and none of its own', 'layer(base)', '', 'layer(base)']
  ])('join %s on an import that stays', (_label, outer, own, joined) => {
    const root = makeProject({
      'styles.css': `@import "./a.css" ${outer};\n`,
      'a.css': `@import "https://example.com/x.css" ${own};\n.a{}\n`
    })
    const result = inline(root, 'styles.css')

    expect(result.css.split('\n')[0]).toBe(
      `@import "https://example.com/x.css" ${joined};`
    )

    expect(result.files).toEqual([path.join(root, 'a.css')])
    expect(result.skipped).toEqual([])
  })

  it('join the conditions of every import on the way, three sheets down', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css" layer(one);\n',
      'a.css': '@import "./b.css" supports(display: grid);\n',
      'b.css': '@import "./c.css" layer(two) screen;\n',
      'c.css': '@import "https://example.com/x.css" (min-width: 600px);\n.c{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css.split('\n')[0]).toBe(
      '@import "https://example.com/x.css" layer(one.two) supports(display: grid) screen and (min-width: 600px);'
    )

    expect(result.css.replace(/\s+/g, '')).toBe(
      '@import"https://example.com/x.css"layer(one.two)supports(display:grid)screenand(min-width:600px);@layerone{@supports(display:grid){@layertwo{@mediascreen{.c{}}}}}'
    )
  })

  // A plugin that runs after this step brings a package in wherever its
  // @import stands, so one left in a block is not reported as lost.
  it('leave a package in place under a condition, with nothing to say', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css" layer;\n.own{}\n',
      'a.css': '@import "tailwindcss/preflight.css";\n.a{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(
      '@layer {\n@import "tailwindcss/preflight.css";\n.a{}\n\n}\n.own{}\n'
    )

    expect(result.skipped).toEqual([])
  })

  // A block ends the run of imports, and so the place an import can lead from.
  it('place an import that stays ahead of a layer block that ends the head', () => {
    const root = makeProject({
      'styles.css':
        '@layer a, b;\n@import "./x.css";\n@import "https://example.com/k.css";\n@layer {\n.z{}\n}\n@layer c;\n@import "./late.css";\n',
      'x.css': '.x{}\n',
      'late.css': '.late{}\n'
    })

    expect(inline(root, 'styles.css').css).toBe(
      '@layer a, b;\n@import "https://example.com/k.css";\n.x{}\n\n\n@layer {\n.z{}\n}\n@layer c;\n@import "./late.css";\n'
    )
  })

  // A package a sheet in another folder names goes to the head as written.
  it('keep a package as written when it stays from a sheet in another folder', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css': '@import "pkg/y.css";\n.a{}\n'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe('@import "pkg/y.css";\n\n.a{}\n\n.own{}\n')
    expect(result.missing).toEqual([path.join(root, 'shared', 'pkg', 'y.css')])
  })

  // Two places where the check leans toward a warning it may not owe.
  it('warn for an import into a layer that a list it took to the head already orders', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css";\n',
      'a.css':
        '@layer base, theme;\n@import "https://example.com/x.css" layer(theme);\n@import "./b.css";\n@import "https://example.com/y.css" layer(base);\n',
      'b.css': '.b{}\n'
    })

    expect(inline(root, 'styles.css').moved).toEqual([
      {
        statement: '@import "https://example.com/y.css" layer(base);',
        file: path.join(root, 'a.css')
      }
    ])
  })

  it('say nothing of the rules of the sheet an import is written in, which it led before too', () => {
    const root = makeProject({
      'styles.css':
        '@layer theme;\n@import "./z.css";\n@import "./a.css" layer(theme);\n',
      'z.css': '.z{}\n',
      'a.css': '@import "https://example.com/x.css";\n.a{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css.split('\n').slice(0, 2)).toEqual([
      '@layer theme;',
      '@import "https://example.com/x.css" layer(theme);'
    ])

    expect(result.moved).toEqual([])
  })

  // A browser reads @charset and a list of layer names ahead of an @import,
  // and the list is what sets the order of the layers.
  it('place an import that stays after the opening @charset and layer names', () => {
    const root = makeProject({
      'styles.css':
        '@charset "utf-8";\n/* order */\n@layer reset, theme;\n@import "./reset.css" layer(reset);\n@import "https://cdn.example.com/x.css" layer(theme);\n.own{}\n',
      'reset.css': '.reset{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(
      [
        '@charset "utf-8";',
        '/* order */',
        '@layer reset, theme;',
        '@import "https://cdn.example.com/x.css" layer(theme);',
        '@layer reset {',
        '.reset{}',
        '',
        '}',
        '',
        '.own{}',
        ''
      ].join('\n')
    )

    // The list already fixed where each layer sits, so nothing changed.
    expect(result.moved).toEqual([])
  })

  // The list is what sets the order of the layers, so an import that goes
  // to the head takes along each list it followed in its own sheet.
  it.each([
    [
      'with no condition',
      '',
      [
        '@layer base, theme;',
        '@import "https://cdn.example.com/x.css" layer(theme);',
        '',
        '',
        '.a{}',
        '',
        '.own{}',
        ''
      ]
    ],
    [
      'under a named layer',
      ' layer(ui)',
      [
        '@layer ui.base, ui.theme;',
        '@import "https://cdn.example.com/x.css" layer(ui.theme);',
        '@layer ui {',
        '',
        '',
        '.a{}',
        '',
        '}',
        '.own{}',
        ''
      ]
    ]
  ])('take the list of layer names of an imported sheet to the head, %s', (_label, outer, lines) => {
    const root = makeProject({
      'content/styles.css': `@import "./a.css"${outer};\n.own{}\n`,
      'content/a.css':
        '@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n.a{}\n'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe(lines.join('\n'))
    expect(result.moved).toEqual([])
  })

  it.each([
    ['a media query', 'screen', 'layer(theme) screen'],
    [
      'a supports condition',
      'supports(display: grid)',
      'layer(theme) supports(display: grid)'
    ]
  ])('say an import left its list of layer names behind under %s', (_label, outer, joined) => {
    const root = makeProject({
      'content/styles.css': `@import "./a.css" ${outer};\n.own{}\n`,
      'content/a.css':
        '@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n.a{}\n'
    })
    const result = inline(root, 'content/styles.css')
    const statement = `@import "https://cdn.example.com/x.css" ${joined};`

    expect(result.css.split('\n')[0]).toBe(statement)
    expect(result.css).toContain('{\n@layer base, theme;\n\n.a{}\n\n}')
    expect(result.moved).toEqual([
      {statement, file: path.join(root, 'content', 'a.css')}
    ])
  })

  it('say an import now leads a list of layer names the first sheet wrote after an import', () => {
    const root = makeProject({
      'styles.css':
        '@import "./a.css";\n@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n',
      'a.css': '.a{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(
      '@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n.a{}\n\n\n\n'
    )

    expect(result.moved).toEqual([
      {
        statement: '@import "https://cdn.example.com/x.css" layer(theme);',
        file: path.join(root, 'styles.css')
      }
    ])
  })

  // Inside one layer the later source still wins, so an import moved ahead
  // of rules in its own layer changes the result.
  it.each([
    ['the same layer', 'layer(theme)', '.btn{color:red}\n'],
    ['a layer block the sheet opens', '', '@layer theme{.btn{color:red}}\n'],
    ['a parent of the layer', 'layer(theme)', '.btn{color:red}\n', 'theme.cdn']
  ])('say an import moved past rules that came into %s', (_label, how, local, layer = 'theme') => {
    const root = makeProject({
      'styles.css': `@layer theme;\n@import "./local.css" ${how};\n@import "https://cdn.example.com/x.css" layer(${layer});\n`,
      'local.css': local
    })
    const result = inline(root, 'styles.css')

    expect(result.moved).toEqual([
      {
        statement: `@import "https://cdn.example.com/x.css" layer(${layer});`,
        file: path.join(root, 'styles.css')
      }
    ])
  })

  it('name an import that stays from the first sheet, not the one it was in', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css':
        '@import "./later.css?v=2" print;\n@import "./vars.scss";\n.a{}\n',
      'shared/vars.scss': '$a: 1;'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe(
      [
        '@import "../shared/later.css?v=2" print;',
        '@import "../shared/vars.scss";',
        '',
        '',
        '.a{}',
        '',
        '.own{}',
        ''
      ].join('\n')
    )

    expect(result.missing).toEqual([path.join(root, 'shared', 'later.css')])
  })

  it.each([
    ['a package', '@import "tailwindcss";\n.own{}\n'],
    ['a scoped package', '@import "@scope/ui";\n.own{}\n'],
    ['an alias', '@import "~pkg/style.css";\n.own{}\n'],
    ['a function CSS does not define', '@import "./a.css" theme(reference);\n'],
    ['an import after a rule', '.own{}\n@import "./a.css";\n'],
    ['a Sass file', '@import "./vars.scss";\n.own{}\n'],
    ['a sheet that does not parse', '@import "./a.css";\n.own{color:red\n']
  ])('leave %s as written', (_label, source) => {
    const root = makeProject({
      'styles.css': source,
      'a.css': '.a{}',
      'vars.scss': '$a: 1;'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: source,
      files: [],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      answered: [],
      cycles: []
    })
  })

  it('name every place a sheet that is not there could appear', () => {
    const root = makeProject({
      'content/styles.css': '@import "./gone.css";\n@import "/later";\n'
    })

    expect(inline(root, 'content/styles.css')).toEqual({
      css: '@import "./gone.css";\n@import "/later";\n',
      files: [],
      missing: [
        path.join(root, 'content', 'gone.css'),
        path.join(root, 'public', 'later'),
        path.join(root, 'later'),
        path.join(root, 'public', 'later.css'),
        path.join(root, 'later.css')
      ],
      unreadable: [],
      moved: [],
      skipped: [],
      answered: [],
      cycles: []
    })
  })

  it('name an imported sheet that is not valid CSS, and leave its @import', () => {
    const root = makeProject({
      'styles.css': '@import "./broken.css";\n.own{}\n',
      'broken.css': '.a{color:red\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: '@import "./broken.css";\n.own{}\n',
      files: [],
      missing: [],
      unreadable: [
        {
          request: './broken.css',
          file: path.join(root, 'broken.css'),
          from: path.join(root, 'styles.css'),
          reason: 'The file is not valid CSS.'
        }
      ],
      moved: [],
      skipped: [],
      answered: [path.join(root, 'broken.css')],
      cycles: []
    })
  })
})

function runLoader(
  root: string,
  sheet: string,
  options: {inlineImports?: boolean; uncompiled?: boolean} = {},
  project = root
) {
  const resourcePath = path.join(root, sheet)
  const warnings: Error[] = []
  const errors: Error[] = []
  const watched: string[] = []
  const awaited: string[] = []
  const output = deadCssUrlLoader.call(
    {
      resourcePath,
      getOptions: () => ({
        manifestPath: path.join(project, 'manifest.json'),
        projectPath: project,
        ...options
      }),
      emitWarning: (warning: Error) => warnings.push(warning),
      emitError: (error: Error) => errors.push(error),
      addDependency: (file: string) => watched.push(file),
      addMissingDependency: (file: string) => awaited.push(file),
      _compilation: {warnings, errors}
    } as never,
    fs.readFileSync(resourcePath, 'utf8')
  )

  return {output, warnings, errors, watched, awaited}
}

describe('the loader run that brings imports into a content-script sheet', () => {
  it('answers with CSS and watches each sheet that came in', () => {
    const root = makeProject({
      'content/styles.css': '@import "./other.css";\n.own{color:red}\n',
      'content/other.css': '.imported{color:green}\n'
    })

    const {output, warnings, watched} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('.imported{color:green}\n\n.own{color:red}\n')
    expect(watched).toEqual([path.join(root, 'content', 'other.css')])
    expect(warnings).toEqual([])
  })

  it('warns once, with the reason, for an imported sheet it cannot read', () => {
    const root = makeProject({
      'content/styles.css': '@import "./broken.css";\n.own{}\n',
      'content/broken.css': '.a{color:red\n'
    })

    const {output, warnings, watched} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('@import "./broken.css";\n.own{}\n')
    expect(watched).toEqual([path.join(root, 'content', 'broken.css')])
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Couldn't bring an @import into this content script stylesheet, so the rules of that file will not load.`,
          'PATH content/styles.css',
          'IMPORT ./broken.css',
          'REASON The file is not valid CSS.',
          'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
          'Fix the imported file so its rules ship with this stylesheet.'
        ].join('\n')
      ]
    ])
  })

  it('warns for a sheet outside the project, names where it sits, and still watches it', () => {
    const root = makeProject({
      'app/content/styles.css': '@import "../../shared/tokens.css";\n.own{}\n',
      'shared/tokens.css': '.tokens{}\n'
    })
    const tokens = path.join(root, 'shared', 'tokens.css')

    const {output, warnings, watched} = runLoader(
      root,
      'app/content/styles.css',
      {inlineImports: true},
      path.join(root, 'app')
    )

    expect(output).toBe('@import "../../shared/tokens.css";\n.own{}\n')
    expect(watched).toEqual([tokens])
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Couldn't bring an @import into this content script stylesheet, so the rules of that file will not load.`,
          'PATH content/styles.css',
          'IMPORT ../../shared/tokens.css',
          `REASON The file sits outside the project, at ${fs.realpathSync(tokens).split(path.sep).join('/')}.`,
          'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
          'Keep the sheets a content script stylesheet imports inside the project or its workspace, or in a package it installs.'
        ].join('\n')
      ]
    ])
  })

  it('warns for a private file by its name', () => {
    const root = makeProject({
      'content/styles.css': '@import "../node_modules/pkg/.env";\n.own{}\n',
      'node_modules/pkg/.env': 'KEY=value\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('@import "../node_modules/pkg/.env";\n.own{}\n')
    expect(warnings.map((w) => w.message.split('\n'))).toEqual([
      [
        `${WARN} Couldn't bring an @import into this content script stylesheet, so the rules of that file will not load.`,
        'PATH content/styles.css',
        'IMPORT ../node_modules/pkg/.env',
        'REASON The path holds .env, a name the build keeps private.',
        'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
        'Give the sheet a path with no private file or folder name along it.'
      ]
    ])
  })

  it('names the sheet that wrote an import it could not bring in', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css': '@import "./broken.css";\n.a{}\n',
      'shared/broken.css': '.a{color:red\n'
    })

    const {warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(warnings.map((w) => w.message.split('\n').slice(1, 5))).toEqual([
      [
        'PATH content/styles.css',
        'IMPORT ./broken.css',
        'WRITTEN IN shared/a.css',
        'REASON The file is not valid CSS.'
      ]
    ])
  })

  it('warns once for sheets that import one another', () => {
    const root = makeProject({
      'content/styles.css': '@import "./a.css";\n.own{}\n',
      'content/a.css': '@import "./b.css";\n.a{}\n',
      'content/b.css': '@import "./a.css";\n@import "./a.css";\n.b{}\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('\n\n.b{}\n\n.a{}\n\n.own{}\n')
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Sheets this content script stylesheet brings in with @import import one another, so the import that closes the loop was dropped.`,
          'PATH content/styles.css',
          'LOOP content/a.css > content/b.css > content/a.css',
          'Each sheet came in once, where it was first imported.',
          'Remove one of these @import rules to say which sheet comes first.'
        ].join('\n')
      ]
    ])
  })

  it('brings in the file a name with no ./ has beside the sheet, with no word', () => {
    const root = makeProject({
      'content/styles.css': '@import "other.css";\n.own{}\n',
      'content/other.css': '.other{}\n'
    })

    const {output, warnings, errors, watched} = runLoader(
      root,
      'content/styles.css',
      {inlineImports: true}
    )

    expect(output).toBe('.other{}\n\n.own{}\n')
    expect(watched).toEqual([path.join(root, 'content', 'other.css')])
    expect([warnings, errors]).toEqual([[], []])
  })

  // The run after PostCSS, fed what the run ahead of it answered with.
  function runBoth(root: string, sheet: string) {
    const first = runLoader(root, sheet, {inlineImports: true})
    const warnings: Error[] = []

    deadCssUrlLoader.call(
      {
        resourcePath: path.join(root, sheet),
        getOptions: () => ({
          manifestPath: path.join(root, 'manifest.json'),
          projectPath: root
        }),
        emitWarning: (warning: Error) => warnings.push(warning),
        emitError() {},
        addDependency() {},
        addMissingDependency() {},
        _compilation: {warnings, errors: []}
      } as never,
      String(first.output)
    )

    return [...first.warnings, ...warnings].map((w) => [
      w.name,
      ...w.message.split('\n').slice(0, 3)
    ])
  }

  const STILL = `${WARN} An @import is still in this content script stylesheet after every tool ran, so the rules it names will not load.`

  it('names an import whose letter case no file beside the sheet has', () => {
    const root = makeProject({
      'content/styles.css': '@import "Reset.css";\n.own{}\n',
      'content/reset.css': '.reset{}\n'
    })

    expect(runBoth(root, 'content/styles.css')).toEqual([
      [
        'CssParseWarning',
        STILL,
        'PATH content/styles.css',
        'IMPORT @import "Reset.css";'
      ]
    ])
  })

  it('names an import whose target cannot be read at all', () => {
    const root = makeProject({
      'content/styles.css': '@import foo.css;\n.own{}\n'
    })

    expect(runBoth(root, 'content/styles.css')).toEqual([
      [
        'CssParseWarning',
        STILL,
        'PATH content/styles.css',
        'IMPORT @import foo.css;'
      ]
    ])
  })

  it('says one thing of an import with no target inside a block', () => {
    const root = makeProject({
      'content/styles.css': '@import "./a.css" screen;\n.own{}\n',
      'content/a.css': '@import nothing;\n.a{}\n'
    })

    expect(
      runBoth(root, 'content/styles.css').map(([, headline]) => headline)
    ).toEqual([
      `${WARN} An @import in a sheet this content script stylesheet imports will not load.`
    ])
  })

  // The run after PostCSS forgets what the run ahead of it said once read.
  it('answers for one build of the sheet only', () => {
    const root = makeProject({
      'content/styles.css': '@import "./svg.css";\n.own{}\n',
      'content/svg.css':
        '@namespace svg url(http://www.w3.org/2000/svg);\nsvg|a{}\n'
    })

    expect(runBoth(root, 'content/styles.css')).toHaveLength(1)
    expect(
      runLoader(root, 'content/styles.css').warnings.map(
        (w) => w.message.split('\n')[0]
      )
    ).toEqual([STILL])
  })

  // Sass is not installed, so the sheet is still Sass and says so elsewhere.
  it('says nothing of the imports of a sheet no tool compiled', () => {
    const root = makeProject({
      'content/styles.css': '@import "normalize.css";\n.own{}\n'
    })

    expect(
      runLoader(root, 'content/styles.css', {uncompiled: true}).warnings
    ).toEqual([])
  })

  it('names each import no tool brought in, once every tool ran', () => {
    const root = makeProject({
      'content/styles.css': [
        '@import "normalize.css";',
        '@import "normalize.css";',
        '@import url(gone.css);',
        '@import "./vars.scss";',
        '@import "https://example.com/x.css";',
        '@import "//example.com/y.css";',
        '@import "./other.css" layer;',
        '.own{}',
        ''
      ].join('\n'),
      'content/vars.scss': '$a: 1;\n',
      'content/other.css': '@import "pkg/in-a-block.css";\n.other{}\n'
    })

    expect(runBoth(root, 'content/styles.css')).toEqual([
      [
        'CssParseWarning',
        STILL,
        'PATH content/styles.css',
        'IMPORT @import "normalize.css";'
      ],
      [
        'CssParseWarning',
        STILL,
        'PATH content/styles.css',
        'IMPORT @import url(gone.css);'
      ],
      [
        'CssParseWarning',
        STILL,
        'PATH content/styles.css',
        'IMPORT @import "./vars.scss";'
      ],
      [
        'CssParseWarning',
        STILL,
        'PATH content/styles.css',
        'IMPORT @import "pkg/in-a-block.css";'
      ]
    ])
  })

  it('says nothing more of an import a reason was already given for', () => {
    const root = makeProject({
      'content/styles.css':
        '@import "./gone.css";\n@import "../shared/a.css";\n.own{}\n',
      'shared/a.css': '@import "x.css";\n.a{}\n',
      'shared/x.css':
        '@namespace svg url(http://www.w3.org/2000/svg);\nsvg|a{}\n'
    })

    expect(
      runBoth(root, 'content/styles.css').map(([name, headline]) => [
        name,
        headline.replace(`${WARN} `, '').slice(0, 28)
      ])
    ).toEqual([
      ['CssParseWarning', "Couldn't bring an @import in"],
      ['CssDeadRef', 'A url(./gone.css) reference '.slice(0, 28)]
    ])
  })

  // A browser ends a string nobody closed at the line break, of any kind.
  it.each([
    ['a carriage return', '\r'],
    ['a form feed', '\f']
  ])('reads the url() that follows a string %s cuts short', (_label, lineBreak) => {
    const root = makeProject({
      'content/styles.css': `.a{content:"a${lineBreak}}.b{background:url("./icon.png")}\n`,
      'content/icon.png': 'image'
    })

    expect(runLoader(root, 'content/styles.css').output).toContain(
      `url(\\"${bundledFileToken(0)}\\")`
    )
  })

  it('names the files src() and image-set() take as strings the way url() does', () => {
    const root = makeProject({
      'content/styles.css':
        '@font-face{font-family:a;src:src("./a.woff2")}\n.b{background:image-set("./icon.png" 1x)}\n',
      'content/a.woff2': 'font',
      'content/icon.png': 'image'
    })

    const {output} = runLoader(root, 'content/styles.css')

    expect(output).toContain(`src(\\"${bundledFileToken(0)}\\")`)
    expect(output).toContain(`image-set(\\"${bundledFileToken(1)}\\" 1x)`)
  })

  // A string is text, whatever it spells.
  it('leaves a url( that is the text of a string as written', () => {
    const root = makeProject({
      'content/styles.css':
        '.a::before{content:"url(./icon.png)"}\n.b{background:url(./icon.png)}\n',
      'content/icon.png': 'image'
    })

    const {output} = runLoader(root, 'content/styles.css')

    expect(output).toContain('content:\\"url(./icon.png)\\"')
    expect(output).toContain(`background:url(\\"${bundledFileToken(0)}\\")`)
  })

  it('warns once for an import that now leads rules it used to follow', () => {
    const root = makeProject({
      'content/styles.css':
        '@import "./other.css";\n@import "https://example.com/x.css";\n@import "https://example.com/x.css";\n.own{}\n',
      'content/other.css': '.imported{}\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe(
      '@import "https://example.com/x.css";\n@import "https://example.com/x.css";\n.imported{}\n\n\n\n.own{}\n'
    )

    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Moved an @import to the top of this content script stylesheet, ahead of rules it used to follow.`,
          'PATH content/styles.css',
          'IMPORT @import "https://example.com/x.css";',
          'The sheets imported before it are now rules in this file, and a browser skips an @import that follows a rule.',
          'Write this @import first, or set the order with @layer, to keep the cascade you wrote.'
        ].join('\n')
      ]
    ])
  })

  it.each([
    [
      'an unnamed layer',
      'layer',
      '',
      [
        'Its sheet came in under an unnamed layer, which no @import can name, and a browser skips an @import inside a block.',
        'Name the layer on the import that brings its sheet in, as in layer(name).'
      ]
    ],
    [
      'another media type',
      'print',
      ' screen',
      [
        'Its sheet came in under one media type and this import asks for another, and no device is both.',
        'Remove this @import, or change one of the two media types.'
      ]
    ],
    [
      'a media query that cannot be joined',
      'screen, print',
      ' (min-width: 600px)',
      [
        'Its sheet came in under a media query that cannot be joined with the one on this import, and a browser skips an @import inside a block.',
        'Move this @import to the content script stylesheet itself, with both conditions written out.'
      ]
    ],
    [
      'a function CSS does not define',
      'screen',
      ' theme(reference)',
      [
        'It carries a function CSS does not define and its sheet came in under a condition, and a browser skips an @import inside a block.',
        'Move this @import to the content script stylesheet itself.'
      ]
    ]
  ])('warns once, with the fix that fits, for an import left in a block under %s', (_label, outer, own, lines) => {
    const root = makeProject({
      'content/styles.css': `@import "./parts/other.css" ${outer};\n.own{}\n`,
      'content/parts/other.css': `@import "https://example.com/x.css"${own};\n.imported{}\n`
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toContain(
      `{\n@import "https://example.com/x.css"${own};\n.imported{}\n\n}\n.own{}\n`
    )

    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} An @import in a sheet this content script stylesheet imports will not load.`,
          'PATH content/styles.css',
          `IMPORT @import "https://example.com/x.css"${own};`,
          'WRITTEN IN content/parts/other.css',
          ...lines
        ].join('\n')
      ]
    ])
  })

  it('names the sheet that wrote an import it moved', () => {
    const root = makeProject({
      'content/styles.css':
        '@import "./one.css";\n@import "./parts/two.css";\n',
      'content/one.css': '.one{}\n',
      'content/parts/two.css': '@import "https://example.com/x.css";\n.two{}\n'
    })

    const {warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(warnings.map((w) => w.message.split('\n').slice(1, 4))).toEqual([
      [
        'PATH content/styles.css',
        'IMPORT @import "https://example.com/x.css";',
        'WRITTEN IN content/parts/two.css'
      ]
    ])
  })

  it('reports an import that stays from a sheet two imports down', () => {
    const root = makeProject({
      'content/styles.css': '@import "./a.css" screen;\n',
      'content/a.css': '@import "./b.css";\n',
      'content/b.css': '@import "./gone.css";\n.b{}\n'
    })

    const first = runLoader(root, 'content/styles.css', {inlineImports: true})

    expect(first.awaited).toEqual([path.join(root, 'content', 'gone.css')])
    expect(first.output.split('\n')[0]).toBe('@import "./gone.css" screen;')

    fs.writeFileSync(path.join(root, 'content', 'styles.css'), first.output)

    const second = runLoader(root, 'content/styles.css')

    expect(second.warnings.map((report) => report.name)).toEqual(['CssDeadRef'])
    expect(second.warnings[0].message).toContain('NOT FOUND ./gone.css')
  })

  it.each([
    ['false', 'warnings'],
    ['true', 'errors']
  ] as const)('reports an @import of a file that is nowhere, strict refs %s', (strict, sink) => {
    vi.stubEnv('EXTENSION_STRICT_REFS', strict)
    const root = makeProject({
      'content/styles.css': '@import "./gone.css";\n.own{}\n'
    })

    const first = runLoader(root, 'content/styles.css', {inlineImports: true})
    const second = runLoader(root, 'content/styles.css')

    expect(first.awaited).toEqual([path.join(root, 'content', 'gone.css')])
    expect(second[sink].map((report) => report.name)).toEqual(['CssDeadRef'])
    expect(second[sink][0].message).toContain('NOT FOUND ./gone.css')
    expect(second[sink === 'errors' ? 'warnings' : 'errors']).toEqual([])
  })
})

// The workspace's own copy of a package, linked into a fixture project.
function linkWorkspacePackage(root: string, name: string) {
  const entry = createRequire(import.meta.url).resolve(name)
  const marker = `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}`
  const source = entry.slice(0, entry.lastIndexOf(marker) + marker.length)
  const dest = path.join(root, 'node_modules', name)

  fs.mkdirSync(path.dirname(dest), {recursive: true})

  try {
    if (process.platform === 'win32') throw new Error('copy')

    fs.symlinkSync(source, dest, 'dir')
  } catch {
    // Windows needs a privilege to link, so the package is copied there.
    fs.cpSync(fs.realpathSync(source), dest, {recursive: true})
  }
}

// The processed text the runtime stylesheet module keeps as one literal.
function emittedSheet(distDir: string): string {
  for (const entry of fs.readdirSync(distDir, {recursive: true}) as string[]) {
    if (!entry.endsWith('.js')) continue

    const js = fs.readFileSync(path.join(distDir, entry), 'utf8')
    const literal = js.match(/__extjsCssText = ("(?:[^"\\]|\\.)*")/)
    if (literal) return JSON.parse(literal[1])
  }

  throw new Error(`No content-script sheet was emitted under ${distDir}`)
}

async function compileIssues(
  root: string
): Promise<{issues: string[]; distDir: string}> {
  // The rules name the compiled loaders, which only the compile step writes.
  const loader = resolveDevelopDistFile('dead-css-url-loader')

  if (!fs.existsSync(loader)) {
    throw new Error(
      `This spec compiles with the loaders in programs/develop/dist and ${loader} is missing. ` +
        'Run `pnpm --filter extension-develop compile` first.'
    )
  }

  const rules = await cssInContentScriptLoader(
    root,
    path.join(root, 'manifest.json'),
    'production'
  )
  const distDir = path.join(root, 'out')
  const compiler = rspack({
    context: root,
    mode: 'production',
    devtool: false,
    entry: {
      'content/scripts': {
        import: path.join(root, 'content', 'scripts.js'),
        layer: 'extensionjs-content-script'
      }
    },
    output: {path: distDir, filename: '[name].js'},
    module: {rules},
    optimization: {minimize: false}
  })

  const issues = await new Promise<string[]>((resolve, reject) =>
    compiler.run((error, stats) =>
      compiler.close(() =>
        error || !stats
          ? reject(error)
          : resolve(
              [...stats.compilation.errors, ...stats.compilation.warnings].map(
                (issue) => issue.message
              )
            )
      )
    )
  )

  return {issues, distDir}
}

async function compileContentScript(root: string): Promise<string> {
  const {issues, distDir} = await compileIssues(root)

  expect(issues).toEqual([])

  return emittedSheet(distDir)
}

const SCRIPT =
  "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n"

describe('a content script that imports a sheet with an @import, compiled', () => {
  it('ships the imported rules in the one sheet, with its url() as a bundled file', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "./parts/other.css";\n.own{color:red}\n',
      'content/parts/other.css': '.imported{background:url(./icon.png)}\n',
      'content/parts/icon.png': 'image'
    })

    expect(await compileContentScript(root)).toBe(
      `.imported{background:url("${bundledFileToken(0)}")}\n\n.own{color:red}\n`
    )
  }, 60_000)

  // The bundler drops the mark of the file it reads, and the sheets that
  // file imports are read here, mark and all.
  it('ships every rule of a sheet that opens with a byte order mark', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': `${BOM}@import "./other.css";\n.own{color:red}\n`,
      'content/other.css': `${BOM}.imported{color:green}\n`
    })

    expect(await compileContentScript(root)).toBe(
      '.imported{color:green}\n\n.own{color:red}\n'
    )
  }, 60_000)

  // The Tailwind plugin brings a package in wherever its @import stands, a
  // block included, so this step says nothing of one it leaves there.
  it('leaves a package under an unnamed layer to Tailwind, which brings it in there', async () => {
    const root = makeProject({
      'package.json': JSON.stringify({
        name: 'css-fixture',
        devDependencies: {
          tailwindcss: '^4.0.0',
          '@tailwindcss/postcss': '^4.0.0'
        }
      }),
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "./other.css" layer;\n.own{color:red}\n',
      'content/other.css':
        '@import "tailwindcss/preflight.css";\n.imported{color:green}\n'
    })

    linkWorkspacePackage(root, 'tailwindcss')
    linkWorkspacePackage(root, '@tailwindcss/postcss')

    const sheet = await compileContentScript(root)

    expect(sheet).not.toContain('@import')
    expect(sheet.replace(/\s+/g, '')).toMatch(
      /@layer\{\*,::after.*box-sizing:border-box.*\.imported\{color:green;?\}\}\.own\{color:red;?\}$/
    )
  }, 60_000)

  it('ships the rules of a file named with no ./ ahead of it, in each sheet', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "reset.css";\n.own{color:red}\n',
      'content/reset.css': '@import "parts/base.css";\n.reset{margin:0}\n',
      'content/parts/base.css': '.base{color:green}\n'
    })

    expect(await compileContentScript(root)).toBe(
      '.base{color:green}\n\n.reset{margin:0}\n\n.own{color:red}\n'
    )
  }, 60_000)

  it('reads tailwindcss as the package with tailwindcss.css beside the sheet', async () => {
    const root = makeProject({
      'package.json': JSON.stringify({
        name: 'css-fixture',
        devDependencies: {
          tailwindcss: '^4.0.0',
          '@tailwindcss/postcss': '^4.0.0'
        }
      }),
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "tailwindcss";\n.own{color:red}\n',
      'content/tailwindcss.css': '.local{color:green}\n'
    })

    linkWorkspacePackage(root, 'tailwindcss')
    linkWorkspacePackage(root, '@tailwindcss/postcss')

    const sheet = await compileContentScript(root)

    expect(sheet).toContain('box-sizing')
    expect(sheet).not.toContain('.local')
    expect(sheet).not.toContain('@import')
  }, 60_000)

  // No plugin brings the package in, at the head or inside the block.
  it('warns for each package no plugin brought in, and still ships the sheet', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css':
        '@import "nope.css";\n@import "./other.css" layer;\n.own{color:red}\n',
      'content/other.css': '@import "normalize.css";\n.imported{color:green}\n'
    })

    const {issues, distDir} = await compileIssues(root)

    expect(
      issues.map((issue) =>
        issue
          .split('\n')
          .filter((line) => /still in this|IMPORT/.test(line))
          .map((line) => line.replace(/^.*?(An @import|IMPORT)/, '$1'))
      )
    ).toEqual([
      [
        'An @import is still in this content script stylesheet after every tool ran, so the rules it names will not load.',
        'IMPORT @import "nope.css";'
      ],
      [
        'An @import is still in this content script stylesheet after every tool ran, so the rules it names will not load.',
        'IMPORT @import "normalize.css";'
      ]
    ])

    expect(emittedSheet(distDir)).toContain('.own{color:red}')
  }, 60_000)

  // A sheet that may not come in is not a file to ship either.
  it.skipIf(process.platform === 'win32')(
    'ships no file an @import url() names and may not read',
    async () => {
      const statements = [
        '@import url(./.env);',
        '@import url("./.env.local");',
        '@import url(../../shared/tokens.css);',
        '@import url(./linked.css);'
      ]
      const root = makeProject({
        'app/content/scripts.js': SCRIPT,
        'app/content/styles.css': `${statements.join('\n')}\n.own{color:red}\n`,
        'app/content/.env': 'MARKER_ENV=one\n',
        'app/content/.env.local': 'MARKER_LOCAL=two\n',
        'shared/tokens.css': '.MARKER_SHARED{color:green}\n',
        'outside.css': '.MARKER_LINKED{color:green}\n'
      })
      const app = path.join(root, 'app')

      fs.symlinkSync(
        path.join(root, 'outside.css'),
        path.join(app, 'content', 'linked.css')
      )

      const {issues, distDir} = await compileIssues(app)
      const emitted = (
        fs.readdirSync(distDir, {recursive: true}) as string[]
      ).filter((entry) => fs.statSync(path.join(distDir, entry)).isFile())

      expect(emitted).toEqual([path.join('content', 'scripts.js')])
      expect(
        fs.readFileSync(path.join(distDir, emitted[0]), 'utf8')
      ).not.toMatch(/MARK/)

      // Each statement stays as written, with no address of the extension.
      expect(emittedSheet(distDir)).toBe(
        `${statements.join('\n')}\n.own{color:red}\n`
      )

      expect(issues.map((issue) => /IMPORT (\S+)/.exec(issue)?.[1])).toEqual([
        './.env',
        './.env.local',
        '../../shared/tokens.css',
        './linked.css'
      ])

      for (const issue of issues) {
        expect(issue).toContain('so the rules of that file will not load.')
      }
    },
    60_000
  )

  it('runs the imported rules through the PostCSS config of the project', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "./other.css";\n.own{color:red}\n',
      'content/other.css': '.imported{color:green}\n',
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

    const sheet = await compileContentScript(root)

    expect(sheet).not.toContain('@import')
    expect(sheet.replace(/\s+/g, '')).toBe(
      '.imported{--seen:yes;color:green}.own{--seen:yes;color:red}'
    )
  }, 60_000)
})
