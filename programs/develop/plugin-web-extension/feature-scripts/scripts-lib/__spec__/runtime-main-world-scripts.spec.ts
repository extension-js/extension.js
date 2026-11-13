import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
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
    const {at} = project({
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
      findRegistryCallingPages({
        'options_ui/page': at('options/index.html'),
        'side_panel/default_path': at('panel/index.html'),
        'pages/list': at('list/index.html'),
        'action/index': at('popup/index.html'),
        'pages/missing': at('missing/index.html')
      })
    ).toEqual(['options_ui/page', 'side_panel/default_path', 'pages/list'])
  })

  it('names no page when none is given', () => {
    expect(findRegistryCallingPages(undefined)).toEqual([])
  })
})
