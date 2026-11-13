import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {rememberBuildResolve} from '../../../shared/script-graph'
import {
  findBridgePairingPages,
  findPageRelativeScriptPaths,
  findRuntimeMainWorldEntries
} from '../runtime-main-world-scripts'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, {recursive: true, force: true})
  }
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rt-main-find-'))
  roots.push(root)

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents, 'utf8')
  }

  const at = (name: string) => path.join(root, name)
  const find = (
    includeList: Record<string, string | string[]>,
    pageList?: Record<string, string>
  ) =>
    findRuntimeMainWorldEntries({
      includeList,
      pageList,
      manifestDir: root,
      projectPath: root
    }).map((entry) => entry.entryName)

  return {root, at, find}
}

const page = (...scripts: string[]) =>
  `<!doctype html><html><body>${scripts
    .map((script) => `<script src="${script}"></script>`)
    .join('')}</body></html>\n`

const register = (file: string, world = 'MAIN') =>
  'const api = globalThis.browser || globalThis.chrome\n' +
  `api.scripting.registerContentScripts([{id: "hook", js: ["${file}"], ` +
  `world: "${world}", matches: ["<all_urls>"]}])\n`

const HOOK = 'window.__PAGE_HOOK__ = 1\n'

describe('findRuntimeMainWorldEntries', () => {
  it('finds a file the background registers into the MAIN world', () => {
    const {at, find} = project({
      'background.js': register('scripts/hook.js'),
      'scripts/hook.js': HOOK
    })

    expect(
      find({
        'background/service_worker': at('background.js'),
        'scripts/hook': at('scripts/hook.js')
      })
    ).toEqual(['scripts/hook'])
  })

  it('finds a file an options page script registers into the MAIN world', () => {
    const {at, find} = project({
      'background.js': 'console.log("bg")\n',
      'options/index.html': page('./options.js'),
      'options/options.js': register('scripts/hook.js'),
      'scripts/hook.js': HOOK
    })

    expect(
      find(
        {
          'background/service_worker': at('background.js'),
          'scripts/hook': at('scripts/hook.js')
        },
        {'options_ui/page': at('options/index.html')}
      )
    ).toEqual(['scripts/hook'])
  })

  it('reads every script of every page, a pages/ folder page included', () => {
    const {at, find} = project({
      'popup/index.html': page('./first.js', './popup.js'),
      'popup/first.js': 'var FIRST = 1\n',
      'popup/popup.js': register('/scripts/hook.js'),
      'pages/welcome.html': page('./welcome.js'),
      'pages/welcome.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, ' +
        'files: ["scripts/probe.js"], world: "MAIN"})\n',
      'scripts/hook.js': HOOK,
      'scripts/probe.js': HOOK,
      'scripts/plain.js': HOOK
    })

    expect(
      find(
        {
          'scripts/hook': at('scripts/hook.js'),
          'scripts/probe': at('scripts/probe.js'),
          'scripts/plain': at('scripts/plain.js')
        },
        {
          'action/index': at('popup/index.html'),
          'pages/welcome': at('pages/welcome.html')
        }
      )
    ).toEqual(['scripts/hook', 'scripts/probe'])
  })

  it('leaves a page registration outside the MAIN world alone', () => {
    const {at, find} = project({
      'options/index.html': page('./options.js'),
      'options/options.js': register('scripts/hook.js', 'ISOLATED'),
      'scripts/hook.js': HOOK
    })

    expect(
      find(
        {'scripts/hook': at('scripts/hook.js')},
        {'options_ui/page': at('options/index.html')}
      )
    ).toEqual([])
  })

  it('skips a page that is missing, remote scripted or has no script', () => {
    const {at, find} = project({
      'empty/index.html': page(),
      'remote/index.html': page('https://cdn.example/x.js', './gone.js'),
      'scripts/hook.js': HOOK
    })

    expect(
      find(
        {'scripts/hook': at('scripts/hook.js')},
        {
          'pages/empty': at('empty/index.html'),
          'pages/remote': at('remote/index.html'),
          'pages/missing': at('missing/index.html')
        }
      )
    ).toEqual([])
  })

  it('finds nothing where the project has no scripts/ entry to register', () => {
    const {at, find} = project({
      'options/index.html': page('./options.js'),
      'options/options.js': register('scripts/hook.js')
    })

    expect(
      find(
        {'background/service_worker': at('options/options.js')},
        {'options_ui/page': at('options/index.html')}
      )
    ).toEqual([])
  })
})

describe('findBridgePairingPages', () => {
  it('names each page whose scripts reach the content script registry', () => {
    const {at, root} = project({
      'options/index.html': page('./options.js'),
      'options/options.js': register('scripts/hook.js'),
      'panel/index.html': page('./panel.js'),
      'panel/panel.js':
        'chrome.scripting.unregisterContentScripts({ids: ["hook"]})\n',
      'list/index.html': page('./list.js'),
      'list/list.js': 'chrome.scripting.getRegisteredContentScripts()\n',
      'popup/index.html': page('./popup.js'),
      'popup/popup.js': 'document.title = "popup"\n'
    })

    expect(
      findBridgePairingPages(
        {
          'options_ui/page': at('options/index.html'),
          'side_panel/default_path': at('panel/index.html'),
          'pages/list': at('list/index.html'),
          'action/index': at('popup/index.html'),
          'pages/missing': at('missing/index.html')
        },
        root
      )
    ).toEqual(['options_ui/page', 'side_panel/default_path', 'pages/list'])
  })

  it('names a page whose imported module reaches the registry', () => {
    const {at, root} = project({
      'options/index.html': page('./options.js'),
      'options/options.js': 'import "./registry.js"\n',
      'options/registry.js': register('/scripts/hook.js'),
      'popup/index.html': page('./popup.js'),
      'popup/popup.js': 'import "./title.js"\n',
      'popup/title.js': 'document.title = "popup"\n'
    })

    expect(
      findBridgePairingPages(
        {
          'options_ui/page': at('options/index.html'),
          'action/index': at('popup/index.html')
        },
        root
      )
    ).toEqual(['options_ui/page'])
  })

  it('names a page that injects a MAIN world file, inline or imported', () => {
    const inject = (world: string) =>
      'const api = globalThis.browser || globalThis.chrome\n' +
      'api.scripting.executeScript({target: {tabId: 1}, ' +
      `files: ["/scripts/hook.js"], world: "${world}"})\n`
    const {at, root} = project({
      'options/index.html': page('./options.js'),
      'options/options.js': inject('MAIN'),
      'panel/index.html': page('./panel.js'),
      'panel/panel.js': 'import "./inject.js"\n',
      'panel/inject.js': inject('MAIN'),
      'popup/index.html': page('./popup.js'),
      'popup/popup.js': inject('ISOLATED')
    })

    expect(
      findBridgePairingPages(
        {
          'options_ui/page': at('options/index.html'),
          'side_panel/default_path': at('panel/index.html'),
          'action/index': at('popup/index.html')
        },
        root
      )
    ).toEqual(['options_ui/page', 'side_panel/default_path'])
  })

  it('names no page when none is given', () => {
    expect(findBridgePairingPages(undefined, os.tmpdir())).toEqual([])
  })
})

describe('a registration written in a module the entry imports', () => {
  const scripts = (at: (name: string) => string) => ({
    'scripts/hook': at('scripts/hook.js')
  })

  it('follows a static import from the background', () => {
    const {at, find} = project({
      'background.js': 'import "./register-hooks.js"\n',
      'register-hooks.js': register('scripts/hook.js'),
      'scripts/hook.js': HOOK
    })

    expect(
      find({'background/service_worker': at('background.js'), ...scripts(at)})
    ).toEqual(['scripts/hook'])
  })

  it('follows export from, import() and require with a literal', () => {
    for (const background of [
      'export {start} from "./register-hooks.js"\n',
      'import("./register-hooks.js")\n',
      'const hooks = require("./register-hooks.js")\n'
    ]) {
      const {at, find} = project({
        'background.js': background,
        'register-hooks.js': `export const start = 1\n${register('scripts/hook.js')}`,
        'scripts/hook.js': HOOK
      })

      expect(
        find({'background/service_worker': at('background.js'), ...scripts(at)})
      ).toEqual(['scripts/hook'])
    }
  })

  it('follows a page into a .tsx component named without its extension', () => {
    const {at, find} = project({
      'options/index.html': page('./options.tsx'),
      'options/options.tsx': 'import App from "./App"\nApp()\n',
      'options/App.tsx': `export default function App() {\n${register('/scripts/hook.js')}}\n`,
      'scripts/hook.js': HOOK
    })

    expect(
      find(scripts(at), {'options_ui/page': at('options/index.html')})
    ).toEqual(['scripts/hook'])
  })

  it('resolves an index file, a .js specifier for a .ts source and a chain', () => {
    const {at, find} = project({
      'background.ts': 'import "./lib"\n',
      'lib/index.ts': 'export * from "./deep/start.js"\n',
      'lib/deep/start.ts': 'import "../../hooks/register"\n',
      'hooks/register.ts': register('scripts/hook.ts'),
      'scripts/hook.ts': HOOK
    })

    expect(
      find({
        'background/service_worker': at('background.ts'),
        'scripts/hook': at('scripts/hook.ts')
      })
    ).toEqual(['scripts/hook'])
  })

  it('resolves a tsconfig paths alias', () => {
    const {at, find} = project({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {baseUrl: '.', paths: {'@/*': ['./src/*']}}
      }),
      'package.json': '{"name": "alias", "private": true}',
      'background.ts': 'import {start} from "@/hooks/register"\nstart()\n',
      'src/hooks/register.ts': `export function start() {\n${register('scripts/hook.js')}}\n`,
      'scripts/hook.js': HOOK
    })

    expect(
      find({'background/service_worker': at('background.ts'), ...scripts(at)})
    ).toEqual(['scripts/hook'])
  })

  it('reads the script block of a single file component', () => {
    const {at, find} = project({
      'options/index.html': page('./options.js'),
      'options/options.js': 'import App from "./App.vue"\n',
      'options/App.vue':
        "<template><p>It's an options page</p></template>\n" +
        `<script setup>\n${register('/scripts/hook.js')}</script>\n`,
      'scripts/hook.js': HOOK
    })

    expect(
      find(scripts(at), {'options_ui/page': at('options/index.html')})
    ).toEqual(['scripts/hook'])
  })

  it('never follows an import into node_modules', () => {
    const {at, find} = project({
      'background.js': 'import "hooks-pkg"\nimport "./node_modules/x.js"\n',
      'node_modules/hooks-pkg/package.json':
        '{"name": "hooks-pkg", "main": "index.js"}',
      'node_modules/hooks-pkg/index.js': register('scripts/hook.js'),
      'node_modules/x.js': register('scripts/hook.js'),
      'scripts/hook.js': HOOK
    })

    expect(
      find({'background/service_worker': at('background.js'), ...scripts(at)})
    ).toEqual([])
  })

  it('ends on an import cycle and on a file that is missing', () => {
    const {at, find} = project({
      'background.js': 'import "./a.js"\nimport "./gone.js"\n',
      'a.js': 'import "./b.js"\n',
      'b.js': `import "./a.js"\n${register('scripts/hook.js')}`,
      'scripts/hook.js': HOOK
    })

    expect(
      find({'background/service_worker': at('background.js'), ...scripts(at)})
    ).toEqual(['scripts/hook'])
  })

  it('reads a module eight imports deep and stops before the ninth', () => {
    const chain = (length: number) => {
      const files: Record<string, string> = {
        'background.js': 'import "./m1.js"\n',
        'scripts/hook.js': HOOK
      }

      for (let i = 1; i < length; i++) {
        files[`m${i}.js`] = `import "./m${i + 1}.js"\n`
      }

      files[`m${length}.js`] = register('scripts/hook.js')

      const {at, find} = project(files)

      return find({
        'background/service_worker': at('background.js'),
        ...scripts(at)
      })
    }

    expect(chain(8)).toEqual(['scripts/hook'])
    expect(chain(9)).toEqual([])
  })

  it('sees a module again once it is rewritten', () => {
    const {at, find} = project({
      'background.js': 'import "./register-hooks.js"\n',
      'register-hooks.js': 'console.log("nothing registered yet")\n',
      'scripts/hook.js': HOOK
    })
    const includeList = {
      'background/service_worker': at('background.js'),
      ...scripts(at)
    }

    expect(find(includeList)).toEqual([])

    fs.writeFileSync(at('register-hooks.js'), register('scripts/hook.js'))

    expect(find(includeList)).toEqual(['scripts/hook'])
  })
})

describe('a registration passed through a constant of the same file', () => {
  const found = (background: string) => {
    const {at, find} = project({
      'background.js': `const api = chrome\n${background}`,
      'scripts/hook.js': HOOK
    })

    return find({
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts/hook.js')
    })
  }

  const GROUP =
    '{id: "hook", js: ["scripts/hook.js"], world: "MAIN", matches: ["<all_urls>"]}'

  it('reads a list of registrations held in a const', () => {
    expect(
      found(
        `const hooks = [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`
      )
    ).toEqual(['scripts/hook'])
  })

  it('reads a typed const declared inside the calling function', () => {
    expect(
      found(
        'async function start() {\n' +
          `  const hooks: chrome.scripting.RegisteredContentScript[] = [${GROUP}]\n` +
          '  await api.scripting.registerContentScripts(hooks)\n}\n'
      )
    ).toEqual(['scripts/hook'])
  })

  it('reads one registration held in a const inside the list', () => {
    expect(
      found(
        `const hook = ${GROUP}\napi.scripting.registerContentScripts([hook])\n`
      )
    ).toEqual(['scripts/hook'])
  })

  it('reads a files list passed as a shorthand property', () => {
    expect(
      found(
        'const files = ["scripts/hook.js"]\n' +
          'api.scripting.executeScript({target: {tabId: 1}, files, world: "MAIN"})\n'
      )
    ).toEqual(['scripts/hook'])
  })

  it('reads a files list passed under another name', () => {
    expect(
      found(
        'const hookFiles = ["scripts/hook.js"] as const\n' +
          'api.scripting.registerContentScripts([{id: "hook", js: hookFiles, world: "MAIN", matches: ["<all_urls>"]}])\n'
      )
    ).toEqual(['scripts/hook'])
  })

  it('reads an injection held whole in a const', () => {
    expect(
      found(
        'const injection = {target: {tabId: 1}, files: ["scripts/hook.js"], world: "MAIN"}\n' +
          'api.scripting.executeScript(injection)\n'
      )
    ).toEqual(['scripts/hook'])
  })

  it('leaves a const outside the MAIN world alone', () => {
    expect(
      found(
        `const hooks = [${GROUP.replace('MAIN', 'ISOLATED')}]\napi.scripting.registerContentScripts(hooks)\n`
      )
    ).toEqual([])
  })

  it('reads a constant named inside the literal of another', () => {
    expect(
      found(
        'const files = ["scripts/hook.js"]\n' +
          'const hooks = [{id: "hook", js: files, world: "MAIN", matches: ["<all_urls>"]}]\n' +
          'api.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual(['scripts/hook'])

    expect(
      found(
        'const HOOK = "scripts/hook.js"\nconst files = [HOOK]\n' +
          'const hook = {id: "hook", js: files, world: "MAIN", matches: ["<all_urls>"]}\n' +
          'const hooks = [hook]\napi.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual(['scripts/hook'])
  })

  it('leaves a constant that is only another name, or names a hidden one, alone', () => {
    expect(
      found(
        `const first = [${GROUP}]\nconst hooks = first\n` +
          'api.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual([])

    expect(
      found(
        'function build(files) {\n' +
          '  const hooks = [{id: "hook", js: files, world: "MAIN", matches: ["<all_urls>"]}]\n' +
          '  api.scripting.registerContentScripts(hooks)\n}\n' +
          'const files = ["scripts/hook.js"]\nbuild([])\n'
      )
    ).toEqual([])
  })

  it('reads a let declared with no value and assigned once before the call', () => {
    expect(
      found(
        `let hooks\nhooks = [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`
      )
    ).toEqual(['scripts/hook'])

    expect(
      found(
        'async function start() {\n' +
          `  let hooks: chrome.scripting.RegisteredContentScript[];\n  hooks = [${GROUP}];\n` +
          '  await api.scripting.registerContentScripts(hooks)\n}\n'
      )
    ).toEqual(['scripts/hook'])
  })

  it('leaves a let with no value alone when its one value is not certain', () => {
    for (const body of [
      // Assigned twice.
      `let hooks\nhooks = [${GROUP}]\nhooks = []\napi.scripting.registerContentScripts(hooks)\n`,
      // Assigned under a condition, with and without a block.
      `let hooks\nif (globalThis.on) {\n  hooks = [${GROUP}]\n}\napi.scripting.registerContentScripts(hooks)\n`,
      `let hooks\nif (globalThis.on) hooks = [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`,
      `let hooks\nif (globalThis.on) x()\nelse hooks = [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`,
      // Assigned after the call, and inside a function called who knows when.
      `let hooks\napi.scripting.registerContentScripts(hooks)\nhooks = [${GROUP}]\n`,
      `let hooks\nfunction fill() {\n  hooks = [${GROUP}]\n}\napi.scripting.registerContentScripts(hooks)\n`,
      // Not a plain assignment.
      `let hooks\nhooks ||= [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`,
      `let hooks\nhooks = make([${GROUP}])\napi.scripting.registerContentScripts(hooks)\n`
    ]) {
      expect(found(body)).toEqual([])
    }
  })

  it('reads a let assigned once, and leaves a name declared twice and an import of no file undetected', () => {
    expect(
      found(
        `let hooks = [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`
      )
    ).toEqual(['scripts/hook'])

    expect(
      found(
        `let hooks = [${GROUP}]\nhooks = []\napi.scripting.registerContentScripts(hooks)\n`
      )
    ).toEqual([])

    expect(
      found(
        `function a() {\n  const hooks = [${GROUP}]\n  return hooks\n}\n` +
          'function b() {\n  const hooks = []\n  api.scripting.registerContentScripts(hooks)\n}\n'
      )
    ).toEqual([])

    expect(
      found(
        'import {hooks} from "./hooks.js"\napi.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual([])
  })
})

describe('a registration behind an alias of the build resolve block', () => {
  const files = {
    'background.js': 'import {start} from "@reg/register"\nstart()\n',
    'src/reg/register.js': `export function start() {\n${register('scripts/hook.js')}}\n`,
    'scripts/hook.js': HOOK
  }
  const include = (at: (name: string) => string) => ({
    'background/service_worker': at('background.js'),
    'scripts/hook': at('scripts/hook.js')
  })

  it('resolves an alias the build was given', () => {
    const {root, at, find} = project(files)

    rememberBuildResolve(root, {alias: {'@reg': at('src/reg')}})

    expect(find(include(at))).toEqual(['scripts/hook'])
  })

  it('resolves an alias listed as name and alias pairs', () => {
    const {root, at, find} = project(files)

    rememberBuildResolve(root, {
      extensions: ['.js', '...'],
      alias: [{name: '@reg', alias: at('src/reg')}]
    })

    expect(find(include(at))).toEqual(['scripts/hook'])
  })

  it('keeps tsconfig paths beside the alias map', () => {
    const {root, at, find} = project({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {baseUrl: '.', paths: {'@/*': ['./src/*']}}
      }),
      'background.ts': 'import {start} from "@/boot"\nstart()\n',
      'src/boot.ts': 'export {start} from "@reg/register"\n',
      'src/reg/register.js': files['src/reg/register.js'],
      'scripts/hook.js': HOOK
    })

    rememberBuildResolve(root, {alias: {'@reg': at('src/reg')}})

    expect(
      find({
        'background/service_worker': at('background.ts'),
        'scripts/hook': at('scripts/hook.js')
      })
    ).toEqual(['scripts/hook'])
  })

  it('reads a file again once the build resolves with another map', () => {
    const {root, at, find} = project(files)

    expect(find(include(at))).toEqual([])

    rememberBuildResolve(root, {alias: {'@reg': at('src/reg')}})

    expect(find(include(at))).toEqual(['scripts/hook'])

    rememberBuildResolve(root, {alias: {'@reg': at('src/elsewhere')}})

    expect(find(include(at))).toEqual([])
  })

  it('still resolves when the block holds what the resolver cannot take', () => {
    const {root, at, find} = project({
      ...files,
      'background.js': 'import "./src/reg/boot.js"\n',
      'src/reg/boot.js': register('scripts/hook.js')
    })

    rememberBuildResolve(root, {alias: {'@reg': 7}, modules: 7, roots: {}})

    expect(find(include(at))).toEqual(['scripts/hook'])
  })
})

describe('a registration in a linked workspace package', () => {
  // A workspace with the extension in apps/ext and the package it links.
  const workspace = (
    marker: Record<string, string>,
    linkTarget: (root: string) => string = (root) =>
      path.join(root, 'packages/shared')
  ) => {
    const {root, at} = project({
      ...marker,
      'apps/ext/package.json': JSON.stringify({
        name: 'ext',
        private: true,
        dependencies: {'@probe/shared': 'workspace:*'}
      }),
      'apps/ext/background.js':
        'import {start} from "@probe/shared"\nstart()\n',
      'apps/ext/scripts/hook.js': HOOK,
      'packages/shared/package.json':
        '{"name": "@probe/shared", "main": "index.js"}',
      'packages/shared/index.js': 'export {start} from "./register.js"\n',
      'packages/shared/register.js': `export function start() {\n${register('scripts/hook.js')}}\n`
    })
    const link = at('apps/ext/node_modules/@probe/shared')

    fs.mkdirSync(path.dirname(link), {recursive: true})
    fs.symlinkSync(linkTarget(root), link, 'dir')

    return findRuntimeMainWorldEntries({
      includeList: {
        'background/service_worker': at('apps/ext/background.js'),
        'scripts/hook': at('apps/ext/scripts/hook.js')
      },
      manifestDir: at('apps/ext'),
      projectPath: at('apps/ext')
    }).map((entry) => entry.entryName)
  }

  it('follows a package linked from a pnpm workspace', () => {
    expect(
      workspace({
        'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n'
      })
    ).toEqual(['scripts/hook'])
  })

  it('follows a package linked from a package.json workspace', () => {
    expect(
      workspace({
        'package.json': JSON.stringify({
          private: true,
          workspaces: ['apps/*', 'packages/*']
        })
      })
    ).toEqual(['scripts/hook'])
  })

  it('leaves a link that leads out of the workspace alone', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rt-outside-'))
    roots.push(outside)
    fs.writeFileSync(
      path.join(outside, 'package.json'),
      '{"name": "@probe/shared", "main": "index.js"}'
    )

    fs.writeFileSync(
      path.join(outside, 'index.js'),
      `export function start() {\n${register('scripts/hook.js')}}\n`
    )

    expect(
      workspace(
        {'pnpm-workspace.yaml': 'packages:\n  - apps/*\n'},
        () => outside
      )
    ).toEqual([])
  })

  it('follows a file: package the package manager copied into node_modules', () => {
    const copied = (spec: string) => {
      const {root, at} = project({
        'ext/package.json': JSON.stringify({
          name: 'ext',
          private: true,
          dependencies: {'@probe/shared': spec}
        }),
        'ext/background.js': 'import {start} from "@probe/shared"\nstart()\n',
        'ext/scripts/hook.js': HOOK,
        'shared/package.json': '{"name": "@probe/shared", "main": "index.js"}',
        'shared/index.js': 'export {start} from "./register.js"\n',
        'shared/register.js': 'export function start() {}\n',
        'ext/node_modules/@probe/shared/package.json':
          '{"name": "@probe/shared", "main": "index.js"}',
        'ext/node_modules/@probe/shared/index.js':
          'export {start} from "./register.js"\n',
        'ext/node_modules/@probe/shared/register.js': `export function start() {\n${register('scripts/hook.js')}}\n`
      })

      return findRuntimeMainWorldEntries({
        includeList: {
          'background/service_worker': at('ext/background.js'),
          'scripts/hook': at('ext/scripts/hook.js')
        },
        manifestDir: path.join(root, 'ext'),
        projectPath: path.join(root, 'ext')
      }).map((entry) => entry.entryName)
    }

    expect(copied('file:../shared')).toEqual(['scripts/hook'])
    // Any other spec is a real install, which is never read.
    expect(copied('^1.0.0')).toEqual([])
    expect(copied('link:../shared')).toEqual([])
    expect(copied('file:../elsewhere')).toEqual([])
  })

  it('leaves a link into a package store under node_modules alone', () => {
    expect(
      workspace(
        {
          'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
          'node_modules/.pnpm/shared@1.0.0/node_modules/@probe/shared/package.json':
            '{"name": "@probe/shared", "main": "index.js"}',
          'node_modules/.pnpm/shared@1.0.0/node_modules/@probe/shared/index.js': `export function start() {\n${register('scripts/hook.js')}}\n`
        },
        (root) =>
          path.join(
            root,
            'node_modules/.pnpm/shared@1.0.0/node_modules/@probe/shared'
          )
      )
    ).toEqual([])
  })
})

describe('a registration passed through a constant another file exports', () => {
  const GROUP =
    '{id: "hook", js: ["scripts/hook.js"], world: "MAIN", matches: ["<all_urls>"]}'

  const found = (background: string, files: Record<string, string>) => {
    const {root, at, find} = project({
      'background.js': `const api = chrome\n${background}`,
      'scripts/hook.js': HOOK,
      ...files
    })

    rememberBuildResolve(root, {alias: {'@lib': at('lib')}})

    return {
      at,
      find: () =>
        find({
          'background/service_worker': at('background.js'),
          'scripts/hook': at('scripts/hook.js')
        })
    }
  }

  it('reads a list of registrations a module exports by name', () => {
    expect(
      found(
        'import {HOOKS} from "./hooks"\napi.scripting.registerContentScripts(HOOKS)\n',
        {
          'hooks.ts': `export const HOOKS: chrome.scripting.RegisteredContentScript[] = [${GROUP}]\n`
        }
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('reads a files list a module exports, beside other names', () => {
    expect(
      found(
        'import {OTHER, FILES} from "./files.js"\n' +
          'api.scripting.executeScript({target: {tabId: 1}, files: FILES, world: "MAIN"})\n',
        {
          'files.js':
            'export const OTHER = ["scripts/other.js"]\n' +
            'export const FILES = ["scripts/hook.js"]\n'
        }
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('reads a shorthand files list imported under another name', () => {
    expect(
      found(
        'import {HOOK_FILES as files} from "./files.js"\n' +
          'api.scripting.executeScript({target: {tabId: 1}, files, world: "MAIN"})\n',
        {'files.js': 'export const HOOK_FILES = ["scripts/hook.js"] as const\n'}
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('reads a default export that is the literal itself', () => {
    expect(
      found(
        'import hook, {unused} from "./hook-registration.js"\n' +
          'api.scripting.registerContentScripts([hook])\n',
        {
          'hook-registration.js': `export const unused = 1\nexport default ${GROUP}\n`
        }
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('reads a constant imported through an alias', () => {
    expect(
      found(
        'import {HOOKS} from "@lib/hooks"\napi.scripting.registerContentScripts(HOOKS)\n',
        {'lib/hooks.js': `export const HOOKS = [${GROUP}]\n`}
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('sees the exporting module again once it is rewritten', () => {
    const {at, find} = found(
      'import {HOOKS} from "./hooks.js"\napi.scripting.registerContentScripts(HOOKS)\n',
      {'hooks.js': 'export const HOOKS = []\n'}
    )

    expect(find()).toEqual([])

    fs.writeFileSync(at('hooks.js'), `export const HOOKS = [${GROUP}]\n`)

    expect(find()).toEqual(['scripts/hook'])
  })

  it('leaves a constant outside the MAIN world alone', () => {
    expect(
      found(
        'import {HOOKS} from "./hooks.js"\napi.scripting.registerContentScripts(HOOKS)\n',
        {
          'hooks.js': `export const HOOKS = [${GROUP.replace('MAIN', 'ISOLATED')}]\n`
        }
      ).find()
    ).toEqual([])
  })

  it('follows a nested constant, a name passed on and a default that is a name', () => {
    const call =
      'import {HOOKS} from "./hooks.js"\napi.scripting.registerContentScripts(HOOKS)\n'

    // A list inside the imported literal, held in a constant of its own.
    expect(
      found(call, {
        'hooks.js':
          'const files = ["scripts/hook.js"]\n' +
          'export const HOOKS = [{id: "hook", js: files, world: "MAIN", matches: ["<all_urls>"]}]\n'
      }).find()
    ).toEqual(['scripts/hook'])

    // A name the module only passes on from a third file.
    expect(
      found(call, {
        'hooks.js': 'export {HOOKS} from "./more.js"\n',
        'more.js': `export const HOOKS = [${GROUP}]\n`
      }).find()
    ).toEqual(['scripts/hook'])

    // A default export that names a constant instead of holding the literal.
    expect(
      found(
        'import hooks from "./hooks.js"\napi.scripting.registerContentScripts(hooks)\n',
        {'hooks.js': `const hooks = [${GROUP}]\nexport default hooks\n`}
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('reads a nested constant the exporting module itself imports', () => {
    expect(
      found(
        'import {HOOKS} from "./hooks.js"\napi.scripting.registerContentScripts(HOOKS)\n',
        {
          'hooks.js':
            'import {FILES} from "./files.js"\n' +
            'export const HOOKS = [{id: "hook", js: FILES, world: "MAIN", matches: ["<all_urls>"]}]\n',
          'files.js':
            'const HOOK = "scripts/hook.js"\nexport const FILES = [HOOK]\n'
        }
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('follows an alias and then a relative specifier of the module it leads to', () => {
    // The folder index is reached by alias, so only its own file says
    // where "./more/list.js" is.
    expect(
      found(
        'import {HOOKS} from "@lib/hooks"\napi.scripting.registerContentScripts(HOOKS)\n',
        {
          'lib/hooks/index.js': 'export {HOOKS} from "./more/list.js"\n',
          'lib/hooks/more/list.js': `export const HOOKS = [${GROUP}]\n`,
          'lib/more/list.js': 'export const HOOKS = []\n'
        }
      ).find()
    ).toEqual(['scripts/hook'])

    expect(
      found(
        'import * as paths from "@lib/paths"\n' +
          'api.scripting.executeScript({target: {tabId: 1}, files: [paths.HOOK], world: "MAIN"})\n',
        {
          'lib/paths/index.ts': 'export * from "./names"\n',
          'lib/paths/names.ts': 'export const HOOK = "scripts/hook.js"\n'
        }
      ).find()
    ).toEqual(['scripts/hook'])
  })

  it('leaves a default that names a function, a class or a call alone', () => {
    for (const exported of [
      `const hooks = [${GROUP}]\nexport default function hooks2() { return hooks }\n`,
      `const hooks = [${GROUP}]\nexport default make(hooks)\n`,
      `let hooks = [${GROUP}]\nhooks = []\nexport default hooks\n`
    ]) {
      expect(
        found(
          'import hooks from "./hooks.js"\napi.scripting.registerContentScripts(hooks)\n',
          {'hooks.js': exported}
        ).find()
      ).toEqual([])
    }
  })

  it('reads an exported let assigned once, and leaves a type import and a package constant alone', () => {
    const call =
      'import {HOOKS} from "./hooks.js"\napi.scripting.registerContentScripts(HOOKS)\n'

    expect(
      found(call, {'hooks.js': `export let HOOKS = [${GROUP}]\n`}).find()
    ).toEqual(['scripts/hook'])

    expect(
      found(call, {
        'hooks.js': `export let HOOKS = [${GROUP}]\nHOOKS = []\n`
      }).find()
    ).toEqual([])

    expect(
      found(
        'import type {HOOKS} from "./hooks.js"\napi.scripting.registerContentScripts(HOOKS)\n',
        {'hooks.js': `export const HOOKS = [${GROUP}]\n`}
      ).find()
    ).toEqual([])

    expect(
      found(
        'import {HOOKS} from "hooks-pkg"\napi.scripting.registerContentScripts(HOOKS)\n',
        {
          'node_modules/hooks-pkg/package.json':
            '{"name": "hooks-pkg", "main": "index.js"}',
          'node_modules/hooks-pkg/index.js': `export const HOOKS = [${GROUP}]\n`
        }
      ).find()
    ).toEqual([])
  })

  it('leaves a name the file both imports and declares alone', () => {
    expect(
      found(
        'import {HOOKS} from "./hooks.js"\n' +
          'function start() {\n  let HOOKS = []\n  api.scripting.registerContentScripts(HOOKS)\n}\n',
        {'hooks.js': `export const HOOKS = [${GROUP}]\n`}
      ).find()
    ).toEqual([])
  })
})

describe('findPageRelativeScriptPaths', () => {
  const relative = (
    files: Record<string, string>,
    pageList: Record<string, string>
  ) => {
    const {at, root} = project({...files, 'scripts/hook.js': HOOK})

    return findPageRelativeScriptPaths({
      includeList: {'scripts/hook': at('scripts/hook.js')},
      pageList: Object.fromEntries(
        Object.entries(pageList).map(([feature, file]) => [feature, at(file)])
      ),
      manifestDir: root,
      projectPath: root
    }).map(({page, file, literal, requested, emitted}) => ({
      page,
      file: path.relative(root, file).split(path.sep).join('/'),
      literal,
      requested,
      emitted
    }))
  }

  it('names a scripts/ path a page registers without a leading slash', () => {
    expect(
      relative(
        {
          'options/index.html': page('./options.js'),
          'options/options.js': register('scripts/hook.js')
        },
        {'options/index': 'options/index.html'}
      )
    ).toEqual([
      {
        page: 'options/index',
        file: 'options/options.js',
        literal: 'scripts/hook.js',
        requested: 'options/scripts/hook.js',
        emitted: 'scripts/hook.js'
      }
    ])
  })

  it('names one outside the MAIN world, an injection and an imported module', () => {
    expect(
      relative(
        {
          'options/index.html': page('./options.js'),
          'options/options.js': `import "./inject.js"\n${register('./scripts/hook.js', 'ISOLATED')}`,
          'options/inject.js':
            'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/hook.js"]})\n'
        },
        {'options/index': 'options/index.html'}
      ).map(({file, literal}) => `${file} ${literal}`)
    ).toEqual([
      'options/options.js ./scripts/hook.js',
      'options/inject.js scripts/hook.js'
    ])
  })

  it('leaves alone a rooted path, a path that climbs to the root and a root page', () => {
    expect(
      relative(
        {
          'options/index.html': page('./options.js', './climb.js'),
          'options/options.js': register('/scripts/hook.js'),
          'options/climb.js': register('../scripts/hook.js'),
          'welcome.html': page('./welcome.js'),
          'welcome.js': register('scripts/hook.js')
        },
        {'options/index': 'options/index.html', welcome: 'welcome.html'}
      )
    ).toEqual([])
  })

  it('leaves alone a path that names no scripts/ entry of the build', () => {
    expect(
      relative(
        {
          'options/index.html': page('./options.js'),
          'options/options.js': register('vendor/lib.js')
        },
        {'options/index': 'options/index.html'}
      )
    ).toEqual([])
  })
})
