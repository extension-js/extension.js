import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import contentScriptWrapper from '../steps/add-content-script-wrapper/content-script-wrapper'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-wrapper-'))
  )
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"fixture"}\n',
    'utf8'
  )

  return dir
}

function createLoaderContext(
  resourcePath: string,
  manifestPath: string,
  browser?: string,
  mode = 'development',
  devSession?: boolean
) {
  return {
    resourcePath,
    _compilation: {},
    emitWarning: vi.fn(),
    getOptions() {
      return {
        manifestPath,
        mode,
        ...(typeof devSession === 'boolean' ? {devSession} : {}),
        ...(browser ? {browser} : {})
      }
    }
  }
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

function createDocumentStub() {
  const nodes: StubElement[] = []

  return {
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
}

function createRealm() {
  return {
    sandbox: {
      chrome: {
        runtime: {
          id: 'spec-extension',
          getURL: (file: string) =>
            `chrome-extension://spec-extension/${String(file).replace(/^\/+/, '')}`
        }
      }
    } as Record<string, unknown>,
    document: createDocumentStub()
  }
}

function runWrapped(output: unknown, realm: ReturnType<typeof createRealm>) {
  const script = String(output).replace(
    /\nexport default __EXTENSIONJS_default__\n$/,
    '\n'
  )
  new Function('globalThis', 'document', script)(realm.sandbox, realm.document)
}

function readMarkerGeneration(realm: ReturnType<typeof createRealm>) {
  const markers = realm.document.querySelectorAll(
    '[data-extjs-reinject-marker="true"]'
  )
  expect(markers).toHaveLength(1)

  return markers[0].getAttribute('data-extjs-reinject-generation')
}

function writeDeclaredEntry(world?: 'MAIN') {
  const projectDir = createTempProject()
  const manifestDir = path.join(projectDir, 'src')
  const contentDir = path.join(manifestDir, 'content')
  fs.mkdirSync(contentDir, {recursive: true})

  const manifestPath = path.join(manifestDir, 'manifest.json')
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
    }),
    'utf8'
  )

  return {manifestPath, resourcePath: path.join(contentDir, 'scripts.ts')}
}

describe('content-script-wrapper loader', () => {
  it('wraps default exports with canonical bundle metadata and css hydration', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const contentDir = path.join(manifestDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(contentDir, 'scripts.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/scripts.ts'],
            world: 'MAIN'
          }
        ]
      }),
      'utf8'
    )

    const context = createLoaderContext(resourcePath, manifestPath)
    const source = [
      "import './styles.css'",
      'export default function mount() {',
      '  return () => {}',
      '}',
      'mount()'
    ].join('\n')

    const wrapped = contentScriptWrapper.call(context as any, source)

    expect(wrapped).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-0";'
    )

    expect(wrapped).toContain(
      'var __EXTENSIONJS_REINJECT_KEY="content_scripts/content-0::script-0";'
    )

    expect(wrapped).toContain('new URL("./styles.css", import.meta.url)')
    expect(wrapped).toContain('data-extjs-reinject-owner')
    expect(wrapped).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
    expect(wrapped).not.toContain('typeof browser === "object"')
    expect(wrapped).not.toContain('typeof chrome === "object"')
    expect(wrapped).toContain('globalThis.browser')
    expect(wrapped).toContain('globalThis.chrome')
    expect(context.emitWarning).toHaveBeenCalledTimes(1)
  })

  it('uses scripts folder paths as explicit bundle keys', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(scriptsDir, 'run.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    const wrapped = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath) as any,
      "console.log('hello scripts folder')"
    )

    expect(wrapped).toContain('var __EXTENSIONJS_BUNDLE_KEY="scripts/run.ts";')
    expect(wrapped).toContain(
      'var __EXTENSIONJS_REINJECT_KEY="scripts/run.ts";'
    )
  })

  it('throws a reserved-folder diagnostic for a shebanged Node.js file in scripts/', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(scriptsDir, 'e2e-auth-launcher.mjs')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    const nodeSource =
      "#!/usr/bin/env node\nimport {spawn} from 'node:child_process'\nspawn('echo', ['hi'])\n"

    expect(() =>
      contentScriptWrapper.call(
        createLoaderContext(resourcePath, manifestPath) as any,
        nodeSource
      )
    ).toThrow(/scripts\/ is a reserved folder/i)

    expect(() =>
      contentScriptWrapper.call(
        createLoaderContext(resourcePath, manifestPath) as any,
        nodeSource
      )
    ).toThrow(/scripts\/e2e-auth-launcher\.mjs/)

    expect(() =>
      contentScriptWrapper.call(
        createLoaderContext(resourcePath, manifestPath) as any,
        nodeSource
      )
    ).toThrow(/shebang/)
  })

  it('throws for a node:-protocol import in scripts/ even without a shebang', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(scriptsDir, 'build.mjs')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    expect(() =>
      contentScriptWrapper.call(
        createLoaderContext(resourcePath, manifestPath) as any,
        "import fs from 'node:fs'\nfs.writeFileSync('x', 'y')\n"
      )
    ).toThrow(/node:/)
  })

  it('still wraps a regular browser-shaped file in scripts/', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(scriptsDir, 'widget.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    const wrapped = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath) as any,
      "document.body.dataset.extjs = '1'\n"
    )
    expect(wrapped).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="scripts/widget.ts";'
    )
  })

  it('passes vendored *.min.js in scripts/ through untouched', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(scriptsDir, 'browser-polyfill.min.js')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    const vendored = '!function(e){"use strict";var t={}}(this);\n'
    const wrapped = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath) as any,
      vendored
    )

    expect(wrapped).toBe(vendored)
    expect(wrapped).not.toContain('__EXTJS_WRAPPER_KIND')
    expect(wrapped).not.toContain('__EXTENSIONJS_REINJECT_GENERATION')
  })

  it('wraps a content script declared under the target browser prefix', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const contentDir = path.join(manifestDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(contentDir, 'scripts.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        'firefox:content_scripts': [
          {matches: ['<all_urls>'], js: ['content/scripts.ts']}
        ]
      }),
      'utf8'
    )

    const source = "console.log('prefixed entry')"

    const firefox = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath, 'firefox') as any,
      source
    )
    expect(firefox).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-0";'
    )

    // The same file is a plain module on a chrome build, so it stays untouched.
    const chrome = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath, 'chrome') as any,
      source
    )
    expect(chrome).toBe(source)
  })

  it('still wraps a *.min.js that is an explicitly declared content_scripts entry', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const contentDir = path.join(manifestDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(contentDir, 'inject.min.js')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {matches: ['<all_urls>'], js: ['content/inject.min.js']}
        ]
      }),
      'utf8'
    )

    const wrapped = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath) as any,
      "console.log('declared min entry')"
    )

    expect(wrapped).toContain('var __EXTJS_WRAPPER_KIND="FS3_INLINE";')
    expect(wrapped).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-0";'
    )
  })

  it('gives each script of a multi-script entry its own reinject identity', () => {
    // Regression guard for the content-multi templates: several js files in
    // ONE content_scripts block share a bundle key but must carry DISTINCT
    // reinject keys. The reinject ownership token derives from the reinject
    // key, so a shared key would make one script's reinject cleanup dispose
    // its siblings' shadow hosts instead of only its own.
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const contentDir = path.join(manifestDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/top-left.ts', 'content/top-right.ts']
          },
          {
            matches: ['<all_urls>'],
            js: ['content/bottom-left.ts']
          }
        ]
      }),
      'utf8'
    )

    const source = 'export default function mount(){ return () => {} }'
    const wrapAt = (relPath: string) =>
      String(
        contentScriptWrapper.call(
          createLoaderContext(
            path.join(manifestDir, relPath),
            manifestPath
          ) as any,
          source
        )
      )

    const topLeft = wrapAt('content/top-left.ts')
    const topRight = wrapAt('content/top-right.ts')
    const bottomLeft = wrapAt('content/bottom-left.ts')

    // Same entry: shared bundle key, per-script reinject keys.
    expect(topLeft).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-0";'
    )

    expect(topRight).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-0";'
    )

    expect(topLeft).toContain(
      'var __EXTENSIONJS_REINJECT_KEY="content_scripts/content-0::script-0";'
    )

    expect(topRight).toContain(
      'var __EXTENSIONJS_REINJECT_KEY="content_scripts/content-0::script-1";'
    )

    // Separate entry: its own bundle key, index restarts per entry.
    expect(bottomLeft).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-1";'
    )

    expect(bottomLeft).toContain(
      'var __EXTENSIONJS_REINJECT_KEY="content_scripts/content-1::script-0";'
    )
  })

  it('keeps non-default-export files in executed mode', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const contentDir = path.join(manifestDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    const resourcePath = path.join(contentDir, 'scripts.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/scripts.ts']
          }
        ]
      }),
      'utf8'
    )

    const wrapped = contentScriptWrapper.call(
      createLoaderContext(resourcePath, manifestPath) as any,
      "console.log('plain module execution')"
    )

    expect(wrapped).toContain('var __EXTJS_WRAPPER_KIND="FS3_INLINE";')
    expect(wrapped).toContain('"executed"')
    expect(wrapped).not.toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
  })

  it('wraps a declared entry referenced through a symlinked ancestor dir', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const contentDir = path.join(manifestDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.ts']}]
      }),
      'utf8'
    )

    fs.writeFileSync(path.join(contentDir, 'scripts.ts'), 'x', 'utf8')

    const linkedRoot = path.join(
      projectDir,
      '..',
      `${path.basename(projectDir)}-link`
    )
    fs.symlinkSync(projectDir, linkedRoot, 'junction')
    tempDirs.push(linkedRoot)
    const linkedResource = path.join(linkedRoot, 'src', 'content', 'scripts.ts')

    const wrapped = contentScriptWrapper.call(
      createLoaderContext(
        linkedResource,
        path.join(manifestDir, 'manifest.json')
      ) as any,
      'export default function mount(){ return () => {} }\nmount()'
    )

    expect(wrapped).toContain(
      'var __EXTENSIONJS_BUNDLE_KEY="content_scripts/content-0";'
    )

    expect(wrapped).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
  })

  it('plants no bare registerCleanup global in dev, production or MAIN world output', () => {
    const isolated = writeDeclaredEntry()
    const mainWorld = writeDeclaredEntry('MAIN')
    const source = 'export default function mount(){ return () => {} }'
    const outputs = {
      dev: contentScriptWrapper.call(
        createLoaderContext(
          isolated.resourcePath,
          isolated.manifestPath
        ) as any,
        source
      ),
      production: contentScriptWrapper.call(
        createLoaderContext(
          isolated.resourcePath,
          isolated.manifestPath,
          undefined,
          'production'
        ) as any,
        source
      ),
      mainWorld: contentScriptWrapper.call(
        createLoaderContext(
          mainWorld.resourcePath,
          mainWorld.manifestPath,
          undefined,
          'production'
        ) as any,
        source
      ),
      mainWorldDev: contentScriptWrapper.call(
        createLoaderContext(
          mainWorld.resourcePath,
          mainWorld.manifestPath
        ) as any,
        source
      )
    }

    for (const output of Object.values(outputs)) {
      expect(output).not.toContain('globalThis.registerCleanup')
    }

    // The prefixed registry stays in an isolated world, and in a MAIN world
    // dev session where the tooling labels it. A shipped MAIN world bundle
    // runs on the host page's window and plants nothing there.
    for (const output of [
      outputs.dev,
      outputs.production,
      outputs.mainWorldDev
    ]) {
      expect(output).toContain('globalThis.__EXTENSIONJS_registerCleanup')
    }

    expect(outputs.mainWorld).not.toContain(
      'globalThis.__EXTENSIONJS_registerCleanup'
    )

    expect(outputs.mainWorld).not.toMatch(/globalThis\.__EXTENSIONJS_\w+\s*=/)

    for (const output of [
      outputs.dev,
      outputs.mainWorld,
      outputs.mainWorldDev
    ]) {
      const realm = createRealm()
      runWrapped(output, realm)
      expect('registerCleanup' in realm.sandbox).toBe(false)
    }

    const shipped = createRealm()
    runWrapped(outputs.mainWorld, shipped)
    expect('__EXTENSIONJS_registerCleanup' in shipped.sandbox).toBe(false)
  })

  it('counts reinject generations across injections for both script shapes', () => {
    const entry = writeDeclaredEntry()
    const shapes = {
      defaultExport: 'export default function mount(){ return () => {} }',
      executed: 'var executed = true'
    }

    for (const source of Object.values(shapes)) {
      const realm = createRealm()

      for (let injection = 0; injection < 3; injection++) {
        runWrapped(
          contentScriptWrapper.call(
            createLoaderContext(entry.resourcePath, entry.manifestPath) as any,
            source
          ),
          realm
        )
      }

      expect(readMarkerGeneration(realm)).toBe('3')
    }
  })

  it('ships no host-page instrumentation from a development build outside a dev session', () => {
    const entry = writeDeclaredEntry()
    const source = 'export default function mount(){ return () => {} }'
    const wrap = (mode: string, devSession?: boolean) =>
      contentScriptWrapper.call(
        createLoaderContext(
          entry.resourcePath,
          entry.manifestPath,
          undefined,
          mode,
          devSession
        ) as any,
        source
      )

    const developmentBuild = wrap('development', false)
    expect(developmentBuild).not.toContain('MutationObserver')
    expect(developmentBuild).not.toContain('data-extjs-debug-')
    expect(developmentBuild).not.toContain('__EXTENSIONJS_DEV_MARKERS_ENABLED')
    expect(developmentBuild).toBe(wrap('production'))

    const devSessionBundle = wrap('development', true)
    expect(devSessionBundle).toContain('MutationObserver')
    expect(devSessionBundle).toBe(wrap('development'))
  })
})

// A declared entry that starts itself at import is cloned by every dev
// re-inject, so the session says why once and names the file.
describe('a declared content script with no default export', () => {
  const selfStarting =
    'const node = document.createElement("div")\ndocument.body.appendChild(node)\n'
  const strip = (value: string) =>
    // eslint-disable-next-line no-control-regex
    value.replace(/\u001b\[[0-9;]*m/g, '')

  function hintsFor(run: () => void): string[] {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      run()

      return log.mock.calls
        .map((call) => strip(call.map(String).join(' ')))
        .filter((line) => line.includes('has no default export'))
    } finally {
      log.mockRestore()
    }
  }

  it('prints the cleanup hint once in a dev session and names the file', () => {
    const entry = writeDeclaredEntry()
    const hints = hintsFor(() => {
      for (let save = 0; save < 3; save++) {
        contentScriptWrapper.call(
          createLoaderContext(entry.resourcePath, entry.manifestPath) as any,
          selfStarting
        )
      }
    })

    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('src/content/scripts.ts has no default export')
    expect(hints[0]).toContain('Export a default function')
    expect(hints[0]).toContain('returns a cleanup')
    expect(hints[0]).toContain('whole-extension reload')
    expect(hints[0]).toContain('data-extension-root')
    expect(hints[0]).not.toContain('DOM event')
  })

  it('says nothing for a script with a default export, or in a production build', () => {
    const withDefault = writeDeclaredEntry()
    const shipped = writeDeclaredEntry()

    expect(
      hintsFor(() => {
        contentScriptWrapper.call(
          createLoaderContext(
            withDefault.resourcePath,
            withDefault.manifestPath
          ) as any,
          'export default function mount(){ return () => {} }'
        )

        contentScriptWrapper.call(
          createLoaderContext(
            shipped.resourcePath,
            shipped.manifestPath,
            undefined,
            'production'
          ) as any,
          selfStarting
        )
      })
    ).toEqual([])
  })
})
