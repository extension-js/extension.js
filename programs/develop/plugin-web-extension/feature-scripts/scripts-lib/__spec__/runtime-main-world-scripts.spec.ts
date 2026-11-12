import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  findPageRelativeScriptPaths,
  findRegistryCallingPages,
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

describe('findRegistryCallingPages', () => {
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
      findRegistryCallingPages(
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
      findRegistryCallingPages(
        {
          'options_ui/page': at('options/index.html'),
          'action/index': at('popup/index.html')
        },
        root
      )
    ).toEqual(['options_ui/page'])
  })

  it('names no page when none is given', () => {
    expect(findRegistryCallingPages(undefined, os.tmpdir())).toEqual([])
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

  it('stops after one hop', () => {
    expect(
      found(
        'const files = ["scripts/hook.js"]\n' +
          'const hooks = [{id: "hook", js: files, world: "MAIN", matches: ["<all_urls>"]}]\n' +
          'api.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual([])
  })

  it('leaves a let, a name declared twice and an imported name undetected', () => {
    expect(
      found(
        `let hooks = [${GROUP}]\napi.scripting.registerContentScripts(hooks)\n`
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
