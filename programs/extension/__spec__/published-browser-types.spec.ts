import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

const packageRoot = path.resolve(__dirname, '..')

// The string members of `type <name> =` in a TypeScript source, in order.
function unionMembers(file: string, name: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const match = source.match(
    new RegExp(`type ${name} =\\s*((?:\\s*\\|\\s*'[^']+')+)`)
  )
  expect(match, `${name} in ${file}`).not.toBeNull()

  return [...String(match?.[1]).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('the published ExtensionBrowser type', () => {
  it('lists every target the CLI accepts for --browser, in the same order', () => {
    const published = unionMembers(
      path.join(packageRoot, 'types', 'env.d.ts'),
      'ExtensionBrowser'
    )
    // The launchers re-export the config list, so there is one to read.
    const launcher = fs.readFileSync(
      path.join(packageRoot, 'browsers', 'browsers-types.ts'),
      'utf8'
    )
    const config = unionMembers(
      path.join(packageRoot, 'config-types.ts'),
      'BrowserType'
    )

    expect(published).toContain('safari')
    expect(published).toContain('firefox')
    expect(launcher).toContain(
      "export type {BrowserType} from '../config-types'"
    )

    expect(published).toEqual(config)
  })
})

const require = createRequire(__filename)
const typesDir = path.join(packageRoot, 'types')

function packageDir(specifier: string) {
  return path.dirname(require.resolve(`${specifier}/package.json`))
}

// src/sidebar/page-title.ts of the react, preact, svelte, typescript and vue
// templates, as it was while they were typed by @types/chrome.
const sidebarPageTitle = `\
// The panel's question to the page. The content script answers it with the
// page title and url, so the panel never reads the page on its own.
export const PAGE_TITLE_REQUEST = 'getPageTitle'

export interface PageTitleAnswer {
  title: string
  url: string
}

type OnPageTitle = (answer: PageTitleAnswer | undefined) => void

function isWebPage(tab: chrome.tabs.Tab): boolean {
  return typeof tab.url === 'string' && /^https?:/.test(tab.url)
}

// The page the panel is about. When the panel itself is open as a tab (Safari,
// or a test harness) the active tab is the panel, so the most recently used
// web tab stands in for it.
function findPageTab(callback: (tab: chrome.tabs.Tab | undefined) => void) {
  chrome.tabs.query({active: true, lastFocusedWindow: true}, (focused) => {
    const current = focused?.[0]

    if (current && isWebPage(current)) {
      callback(current)

      return
    }

    chrome.tabs.query({}, (tabs) => {
      const webTabs = (tabs ?? []).filter(isWebPage)
      webTabs.sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
      )

      callback(webTabs[0])
    })
  })
}

function askPage(tab: chrome.tabs.Tab, onAnswer: OnPageTitle) {
  if (tab.id === undefined) {
    onAnswer(undefined)

    return
  }

  chrome.tabs.sendMessage(
    tab.id,
    {type: PAGE_TITLE_REQUEST},
    (answer?: PageTitleAnswer) => {
      // A page with no content script in it (a browser page, or one loaded
      // before the extension was) has nobody to answer, so the hint stays up.
      onAnswer(chrome.runtime.lastError ? undefined : answer)
    }
  )
}

// Keeps onChange fed with the current page's title, asking again whenever the
// active tab changes or a page finishes loading. Returns the function that
// stops watching.
export function watchPageTitle(onChange: OnPageTitle): () => void {
  const refresh = () => {
    findPageTab((tab) => {
      if (!tab) {
        onChange(undefined)

        return
      }

      askPage(tab, onChange)
    })
  }

  const onUpdated = (
    _tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo
  ) => {
    if (changeInfo.status === 'complete' || changeInfo.title) refresh()
  }

  chrome.tabs.onActivated.addListener(refresh)
  chrome.tabs.onUpdated.addListener(onUpdated)
  refresh()

  return () => {
    chrome.tabs.onActivated.removeListener(refresh)
    chrome.tabs.onUpdated.removeListener(onUpdated)
  }
}
`

// src/content/scripts.ts of the same five templates, the messaging part.
const contentScript = `\
export function mount() {
  chrome.runtime.onMessage.addListener(answerPageTitle)

  return () => {
    chrome.runtime.onMessage.removeListener(answerPageTitle)
  }
}

function answerPageTitle(
  message: {type?: string} | undefined,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (answer: {title: string; url: string}) => void
) {
  if (!message || message.type !== 'getPageTitle') return

  sendResponse({title: document.title, url: location.href})
}
`

// The eval call of the devtools-react, devtools-preact and
// devtools-typescript templates, each in its own function.
const devtoolsPanel = `\
declare function setInspectedTitle(title: string): void
declare const inspectedTitle: {value: string}
declare const output: HTMLElement

export function reactPanel() {
    chrome.devtools.inspectedWindow.eval<string>(
      'document.title',
      (result, error) => {
        if (error) {
          setInspectedTitle('Could not read the inspected page.')

          return
        }

        setInspectedTitle(result || 'The inspected page has no title.')
      }
    )
}

export function preactPanel() {
    chrome.devtools.inspectedWindow.eval(
      'document.title',
      (result: string, error) => {
        if (error) {
          inspectedTitle.value = 'Could not read the inspected page.'

          return
        }

        inspectedTitle.value = result || 'The inspected page has no title.'
      }
    )
}

export function typescriptPanel() {
  chrome.devtools.inspectedWindow.eval(
    'document.title',
    (result: unknown, error?: unknown) => {
      if (error) {
        output.textContent = 'Could not read the inspected page.'

        return
      }

      output.textContent =
        typeof result === 'string' && result.length > 0
          ? result
          : 'The inspected page has no title.'
    }
  )
}
`

// Call shapes from the samples of the corpus, which @types/chrome typed.
const corpusCalls = `\
chrome.runtime.sendMessage({type: 'ping'}, (response) => {
  console.log(response)
})
chrome.windows.getCurrent((currentWindow) => {
  console.log(currentWindow.id)
})
chrome.tabs.captureVisibleTab((screenshotUrl) => {
  console.log(screenshotUrl.length)
})
chrome.tabs.captureVisibleTab({format: 'png'}, (screenshotUrl) => {
  console.log(screenshotUrl.length)
})
chrome.tabs.reload({bypassCache: true}, () => {})
chrome.tabCapture.getMediaStreamId((streamId) => {
  console.log(streamId.length)
})
chrome.system.display.getInfo((displays) => {
  console.log(displays.length)
})
browser.tabs.getZoom((zoomFactor) => {
  console.log(zoomFactor.toFixed(2))
})

function logRequest(request: unknown, sender: chrome.runtime.MessageSender) {
  console.log(request, sender.tab?.id)
}

chrome.runtime.onMessageExternal.addListener(logRequest)

export {}
`

// The lines of the Google samples that read an enum object, as they are
// written there: alarms, userScripts, web-accessible-resources, identity
// and the three offscreen cookbook samples.
const enumObjects = `\
declare function showReadme(): void
declare function displayOutput(text: string): void
declare const path: string
declare const OFFSCREEN_DOCUMENT_PATH: string

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) {
    return;
  }
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason == chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    showReadme();
  }
});

function getEmail() {
  chrome.identity
    .getProfileUserInfo({ accountStatus: chrome.identity.AccountStatus.ANY })
    .then((profile_user_info) => {
      displayOutput(
        'chrome.identity.getProfileUserInfo() returned: ' +
          JSON.stringify(profile_user_info)
      );
    });
}

async function addDocuments() {
  await chrome.offscreen.createDocument({
    url: path,
    reasons: [
      chrome.offscreen.Reason.GEOLOCATION ||
        chrome.offscreen.Reason.DOM_SCRAPING
    ],
    justification: 'add justification for geolocation use here'
  });

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: 'Write text to the clipboard.'
  });

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Parse DOM'
  });
}

export {getEmail, addDocuments}
`

// What the added declarations must leave as it was.
const keptForms = `\
declare const untyped: any

export async function promises(tabId: number) {
  const zoom: number = await chrome.tabs.getZoom(untyped)
  const answer: unknown = await chrome.tabs.sendMessage(tabId, untyped)
  const reply: unknown = await chrome.runtime.sendMessage('id', untyped)
  const created = await chrome.windows.create(untyped)

  return [zoom, answer, reply, created?.id]
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  sendResponse(message)

  return true
})

// @ts-expect-error the zoom factor is a number
chrome.tabs.getZoom((zoomFactor: string) => zoomFactor)

// @ts-expect-error the first argument of the listener is the tab id
chrome.tabs.onUpdated.addListener((tabId: string) => tabId)

const change: chrome.tabs.OnUpdatedInfo = {status: 'complete'}
// @ts-expect-error not a field of the change
change.missing

// The enum name is still the type, and the object holds its values alone.
const reason: chrome.runtime.OnInstalledReason =
  chrome.runtime.OnInstalledReason.UPDATE
const sameReason: 'update' = browser.runtime.OnInstalledReason.UPDATE
const scope: 'per-origin' = chrome.tabs.ZoomSettingsScope.PER_ORIGIN
const danger: 'allowlistedByPolicy' =
  chrome.downloads.DangerType.ALLOWLISTED_BY_POLICY
// @ts-expect-error not a value of the enum
chrome.runtime.OnInstalledReason.MISSING

// A class of chrome-types cannot be given a second constructor from here,
// so the no-argument form the browser accepts stays an error and {} is typed.
// @ts-expect-error chrome-types declares one required argument
new chrome.declarativeContent.ShowAction()
const action = new chrome.declarativeContent.ShowAction({})

export {reason, sameReason, scope, danger, action}
`

const sources: Record<string, string> = {
  'src/sidebar/page-title.ts': sidebarPageTitle,
  'src/content/scripts.ts': contentScript,
  'src/panel/scripts.ts': devtoolsPanel,
  'src/corpus.ts': corpusCalls,
  'src/enums.ts': enumObjects,
  'src/kept.ts': keptForms
}

const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

// A project on the default path: extension-env.d.ts names extension/types,
// and chrome-types is the only package that types the extension APIs.
function writeProject(editIndex: (source: string) => string = (s) => s) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-browser-types-'))
  )
  const extensionDir = path.join(root, 'node_modules', 'extension')

  created.push(root)
  fs.mkdirSync(extensionDir, {recursive: true})
  fs.cpSync(typesDir, path.join(extensionDir, 'types'), {recursive: true})
  fs.writeFileSync(
    path.join(extensionDir, 'types', 'index.d.ts'),
    editIndex(fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8'))
  )

  fs.writeFileSync(
    path.join(extensionDir, 'package.json'),
    JSON.stringify({
      name: 'extension',
      version: '0.0.0',
      exports: {'./types': {types: './types/index.d.ts'}}
    })
  )

  for (const name of ['chrome-types', '@types/node']) {
    const link = path.join(root, 'node_modules', name)

    fs.mkdirSync(path.dirname(link), {recursive: true})
    fs.symlinkSync(packageDir(name), link, 'junction')
  }

  for (const [file, source] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), source)
  }

  fs.writeFileSync(
    path.join(root, 'extension-env.d.ts'),
    '/// <reference types="extension/types" />\n'
  )

  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        target: 'esnext',
        moduleResolution: 'bundler',
        lib: ['dom', 'esnext'],
        skipLibCheck: false,
        noEmit: true
      },
      include: ['src', 'extension-env.d.ts']
    })
  )

  return root
}

function typeCheck(root: string) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(packageDir('typescript'), 'bin', 'tsc'),
      '-p',
      root,
      '--pretty',
      'false'
    ],
    {cwd: root, encoding: 'utf8'}
  )

  return {
    status: result.status,
    output: (result.stdout + result.stderr).replace(/\\/g, '/')
  }
}

function errorsIn(output: string, file: string) {
  return [...output.matchAll(/^(\S+)\(\d+,\d+\): error (TS\d+)/gm)]
    .filter((match) => match[1] === file)
    .map((match) => match[2])
}

describe('the default extension API types', () => {
  it('type-check the callback forms the browser accepts', () => {
    const result = typeCheck(writeProject())

    expect(result.output).toBe('')
    expect(result.status).toBe(0)
  }, 60_000)

  // The same project on chrome-types alone, so the fixtures are known to
  // hold the calls it refuses and not calls it already takes.
  it('cover calls that chrome-types alone refuses', () => {
    const result = typeCheck(
      writeProject((index) =>
        index
          .replace(/\/\/\/ <reference path="\.\/chrome\.d\.ts" \/>\r?\n/, '')
          .replace(/\/\/\/ <reference path="\.\/callbacks\.d\.ts" \/>\r?\n/, '')
          .replace(/\/\/\/ <reference path="\.\/enums\.d\.ts" \/>\r?\n/, '')
      )
    )

    expect(result.status).toBe(1)
    expect(errorsIn(result.output, 'src/sidebar/page-title.ts')).toEqual([
      'TS2769',
      'TS2694'
    ])

    expect(errorsIn(result.output, 'src/content/scripts.ts')).toEqual([
      'TS2345',
      'TS2345'
    ])

    expect(errorsIn(result.output, 'src/panel/scripts.ts')).toEqual(
      expect.arrayContaining(['TS2558', 'TS2769'])
    )

    expect(
      errorsIn(result.output, 'src/corpus.ts').filter(
        (code) => code === 'TS2769'
      )
    ).toHaveLength(8)

    expect(errorsIn(result.output, 'src/corpus.ts')).toContain('TS2345')

    // One for each of the 8 sample lines that read an enum object.
    expect(errorsIn(result.output, 'src/enums.ts')).toEqual(
      Array.from({length: 8}, () => 'TS2339')
    )
  }, 60_000)

  it('loads the added declaration files from the default entry only', () => {
    const read = (file: string) =>
      fs.readFileSync(path.join(typesDir, file), 'utf8')

    expect(read('index.d.ts')).toContain('<reference path="./chrome.d.ts" />')
    expect(read('index.d.ts')).toContain(
      '<reference path="./callbacks.d.ts" />'
    )

    expect(read('index.d.ts')).toContain('<reference path="./enums.d.ts" />')

    expect(read('legacy.d.ts')).not.toMatch(
      /chrome\.d\.ts|callbacks\.d\.ts|enums\.d\.ts/
    )
  })
})
