import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import contentScriptWrapper from '../../plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/content-script-wrapper'
import {contentScriptWrapperExtensionsFor} from '../../plugin-web-extension/shared/content-script-wrapper-extensions'
import {ReloadPlugin} from '..'
import {contentScriptReinject} from '../reload-lib/content-script-reinject'
import {
  AddContentScriptReinject,
  wrapsForDevSession
} from '../steps/add-content-script-reinject'

// The wrapper with what a dev session adds to it: a registry of generations,
// owner markers and root sweeps, so a new copy retires the one before it.
const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()

  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function writeDeclaredEntry(world?: 'MAIN') {
  const projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-reinject-'))
  )
  tempDirs.push(projectDir)
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"fixture"}')

  const contentDir = path.join(projectDir, 'src', 'content')
  fs.mkdirSync(contentDir, {recursive: true})

  const manifestPath = path.join(projectDir, 'src', 'manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      manifest_version: 3,
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content/scripts.ts'],
          ...(world ? {world} : {})
        }
      ]
    })
  )

  return {manifestPath, resourcePath: path.join(contentDir, 'scripts.ts')}
}

// The loader the way a build runs it: the reinject runtime rides along only
// when the wrapper reads the build as a dev session.
function wrap(
  entry: {manifestPath: string; resourcePath: string},
  source: string,
  mode = 'development',
  devSession?: boolean,
  browser?: string
) {
  const context = {
    resourcePath: entry.resourcePath,
    emitWarning: vi.fn(),
    getOptions: () => ({
      manifestPath: entry.manifestPath,
      mode,
      ...(typeof devSession === 'boolean' ? {devSession} : {}),
      ...(browser ? {browser} : {}),
      extensions: wrapsForDevSession(mode, devSession)
        ? [contentScriptReinject]
        : []
    })
  }

  return String(contentScriptWrapper.call(context as any, source))
}

class StubElement {
  attributes = new Map<string, string>()
  style: Record<string, string> = {}
  textContent = ''
  nodeType = 1
  shadowRoot = null
  tagName: string
  private readonly nodes: StubElement[]

  constructor(tagName: string, nodes: StubElement[]) {
    this.tagName = tagName.toUpperCase()
    this.nodes = nodes
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  appendChild(child: StubElement) {
    this.nodes.push(child)

    return child
  }

  remove() {
    const index = this.nodes.indexOf(this)
    if (index !== -1) this.nodes.splice(index, 1)
  }
}

// One page whose document outlives each injection, as a tab does.
function createRealm() {
  const nodes: StubElement[] = []
  const document = {
    readyState: 'complete',
    documentElement: new StubElement('html', nodes),
    body: new StubElement('body', nodes),
    createElement: (tagName: string) => new StubElement(tagName, nodes),
    querySelectorAll(selector: string) {
      if (!selector.includes('data-extjs-reinject-marker')) return []

      return nodes.filter(
        (node) => node.getAttribute('data-extjs-reinject-marker') === 'true'
      )
    }
  }

  return {
    sandbox: {
      chrome: {runtime: {id: 'spec-extension', getURL: (file: string) => file}}
    } as Record<string, unknown>,
    document
  }
}

function runWrapped(output: string, realm: ReturnType<typeof createRealm>) {
  const script = output.replace(
    /\nexport default __EXTENSIONJS_default__\n$/,
    '\n'
  )
  new Function('globalThis', 'document', script)(realm.sandbox, realm.document)
}

function markerGeneration(realm: ReturnType<typeof createRealm>) {
  const markers = realm.document.querySelectorAll(
    '[data-extjs-reinject-marker="true"]'
  )
  expect(markers).toHaveLength(1)

  return markers[0].getAttribute('data-extjs-reinject-generation')
}

const MOUNTS = 'export default function mount(){ return () => {} }'

describe('the reinject runtime in a content script', () => {
  it('adds owner checks and the executed marker to a dev session bundle', () => {
    const entry = writeDeclaredEntry()
    const mounted = wrap(entry, MOUNTS)
    const executed = wrap(entry, "console.log('plain module execution')")

    expect(mounted).toContain('data-extjs-reinject-owner')
    expect(mounted).toContain('__EXTENSIONJS_DEV_REINJECT__')
    expect(mounted).toContain(
      'try { if (!__EXTENSIONJS_retired) __EXTENSIONJS_cleanup = __EXTENSIONJS_mount('
    )

    expect(executed).toContain('"executed"')

    for (const shipped of [
      wrap(entry, MOUNTS, 'production'),
      wrap(entry, MOUNTS, 'development', false)
    ]) {
      expect(shipped).not.toMatch(/REINJECT_(?:GENERATION|BUILD|REGISTRY)/)
      expect(shipped).not.toContain('data-extjs-reinject-owner')
      expect(shipped).not.toContain('__EXTENSIONJS_retired')
    }
  })

  it('counts reinject generations across injections for both script shapes', () => {
    const entry = writeDeclaredEntry()

    for (const source of [MOUNTS, 'var executed = true']) {
      const realm = createRealm()

      for (let injection = 0; injection < 3; injection++) {
        runWrapped(wrap(entry, source), realm)
      }

      expect(markerGeneration(realm)).toBe('3')
    }
  })

  it('ships no host-page instrumentation from a development build outside a dev session', () => {
    const entry = writeDeclaredEntry()
    const developmentBuild = wrap(entry, MOUNTS, 'development', false)

    expect(developmentBuild).not.toContain('MutationObserver')
    expect(developmentBuild).not.toContain('data-extjs-debug-')
    expect(developmentBuild).not.toContain('__EXTENSIONJS_DEV_MARKERS_ENABLED')
    expect(developmentBuild).toBe(wrap(entry, MOUNTS, 'production'))

    const devSessionBundle = wrap(entry, MOUNTS, 'development', true)
    expect(devSessionBundle).toContain('MutationObserver')
    expect(devSessionBundle).toBe(wrap(entry, MOUNTS))
  })

  it('keeps the host page instrumentation out of a MAIN world bundle', () => {
    const mainWorld = wrap(writeDeclaredEntry('MAIN'), MOUNTS)

    expect(mainWorld).toContain(
      'var __EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED=false;'
    )

    expect(mainWorld).not.toContain('MutationObserver')
    expect(mainWorld).toContain('__EXTENSIONJS_DEV_REINJECT__')
  })
})

describe('when the reload plugin adds the reinject runtime', () => {
  function compilerFor(mode: string) {
    return {
      options: {mode},
      hooks: new Proxy({}, {get: () => ({tap() {}, tapPromise() {}})})
    } as unknown as Compiler
  }

  it('adds it whenever the wrapper reads the build as a dev session', () => {
    const rows: Array<[string, boolean | undefined, boolean]> = [
      ['development', undefined, true],
      ['development', true, true],
      ['development', false, false],
      ['production', undefined, false],
      ['production', true, true],
      ['none', undefined, true]
    ]

    for (const [mode, devSession, expected] of rows) {
      const compiler = compilerFor(mode)
      new AddContentScriptReinject(devSession).apply(compiler)

      expect(contentScriptWrapperExtensionsFor(compiler)).toEqual(
        expected ? [contentScriptReinject] : []
      )
    }
  })

  // The wrapper carried this runtime in every dev session build before it
  // moved here, a session without the reload pipeline included.
  it('adds it ahead of the reload session gate, once per compiler', () => {
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')

    const compiler = compilerFor('development')
    const plugin = new ReloadPlugin({
      manifestPath: path.join(os.tmpdir(), 'absent', 'manifest.json'),
      browser: 'chrome',
      devSession: true
    } as ConstructorParameters<typeof ReloadPlugin>[0])

    plugin.apply(compiler)
    plugin.apply(compiler)

    expect(contentScriptWrapperExtensionsFor(compiler)).toEqual([
      contentScriptReinject
    ])
  })
})

const strip = (value: string) =>
  // eslint-disable-next-line no-control-regex
  value.replace(/\u001b\[[0-9;]*m/g, '')

function hintsFor(run: () => void, says: string): string[] {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  try {
    run()

    return log.mock.calls
      .map((call) => strip(call.map(String).join(' ')))
      .filter((line) => line.includes(says))
  } finally {
    log.mockRestore()
  }
}

// A declared entry that starts itself at import is cloned by every dev
// re-inject, so the session says why once and names the file.
describe('a declared content script with no default export', () => {
  const selfStarting =
    'const node = document.createElement("div")\ndocument.body.appendChild(node)\n'
  const NO_DEFAULT = 'has no default export'

  it('prints the cleanup hint once in a dev session and names the file', () => {
    const entry = writeDeclaredEntry()
    const hints = hintsFor(() => {
      for (let save = 0; save < 3; save++) wrap(entry, selfStarting)
    }, NO_DEFAULT)

    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('src/content/scripts.ts has no default export')
    expect(hints[0]).toContain('Export a default function')
    expect(hints[0]).toContain('returns a cleanup')
    expect(hints[0]).toContain('whole-extension reload')
    expect(hints[0]).toContain('data-extension-root')
    expect(hints[0]).not.toContain('DOM event')
  })

  // Chromium keeps the old copy alive in the tab after a whole-extension
  // reload, and Firefox drops its world, so each engine gets its own line.
  it('says what a whole-extension reload does to the old copy per engine', () => {
    const hintOn = (browser: string) => {
      const entry = writeDeclaredEntry()
      const hints = hintsFor(
        () => wrap(entry, selfStarting, 'development', undefined, browser),
        NO_DEFAULT
      )

      expect(hints).toHaveLength(1)

      return hints[0]
    }

    for (const browser of ['chrome', 'edge', 'chromium']) {
      const hint = hintOn(browser)

      expect(hint).not.toContain("discards the old copy's code")
      expect(hint).toContain(
        'a whole-extension reload leaves the old copy running in the open tab beside the new one'
      )

      expect(hint).toContain('Reload the tab to end it')
      expect(hint).toContain('chrome.runtime.id')
      expect(hint).toContain('data-extension-root')
    }

    const firefox = hintOn('firefox')

    expect(firefox).toContain(
      "A whole-extension reload discards the old copy's code"
    )

    expect(firefox).not.toContain('beside the new one')
    expect(firefox).toContain('data-extension-root')
  })

  it('says nothing for a script with a default export, or in a production build', () => {
    const withDefault = writeDeclaredEntry()
    const shipped = writeDeclaredEntry()

    expect(
      hintsFor(() => {
        wrap(withDefault, MOUNTS)
        wrap(shipped, selfStarting, 'production')
      }, NO_DEFAULT)
    ).toEqual([])
  })
})

describe('the dev session hint for a default export the script also calls', () => {
  const RUNS_TWICE = 'runs more than once'

  function hintsOf(source: string, mode: string, saves = 1) {
    const entry = writeDeclaredEntry()

    fs.writeFileSync(entry.resourcePath, source)

    return hintsFor(() => {
      for (let save = 0; save < saves; save++) wrap(entry, source, mode)
    }, RUNS_TWICE)
  }

  const CALLED_LATER =
    'export default function main() {}\n' +
    "document.addEventListener('DOMContentLoaded', () => {\n  main()\n})\n"

  it('says once per file that the function runs more than once, and why it matters', () => {
    expect(hintsOf(CALLED_LATER, 'development', 3)).toEqual([
      '\u23f5\u23f5\u23f5 Warning: src/content/scripts.ts calls main() itself, and Extension.js also runs the default export once the page is ready, so main runs more than once.\n' +
        'Only the run Extension.js starts has its cleanup called before the next copy in this dev session, so what the other run adds stays on the page.\n' +
        'Remove the call if one run is what you want. Keep it if another run is intended, for example on a navigation event.'
    ])
  })

  it('says nothing in a production build', () => {
    expect(hintsOf(CALLED_LATER, 'production')).toEqual([])
  })

  it('says nothing when the only call is the top-level one it leaves out', () => {
    expect(
      hintsOf('export default function main() {}\nmain()\n', 'development')
    ).toEqual([])
  })

  it('says nothing for a function that calls itself again, as a retry does', () => {
    expect(
      hintsOf(
        'export default function main() {\n' +
          '  if (!document.body) setTimeout(() => main(), 50)\n' +
          '}\n',
        'development'
      )
    ).toEqual([])
  })
})
