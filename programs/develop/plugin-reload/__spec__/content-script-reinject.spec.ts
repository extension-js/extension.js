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
  devSession?: boolean
) {
  const context = {
    resourcePath: entry.resourcePath,
    emitWarning: vi.fn(),
    getOptions: () => ({
      manifestPath: entry.manifestPath,
      mode,
      ...(typeof devSession === 'boolean' ? {devSession} : {}),
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
