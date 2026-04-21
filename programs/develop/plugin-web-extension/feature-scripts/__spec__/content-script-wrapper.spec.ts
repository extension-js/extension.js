import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import contentScriptWrapper from '../steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-wrapper-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"fixture"}\n',
    'utf8'
  )
  return dir
}

function createLoaderContext(resourcePath: string, manifestPath: string) {
  return {
    resourcePath,
    _compilation: {},
    emitWarning: vi.fn(),
    getOptions() {
      return {
        manifestPath,
        mode: 'development'
      }
    }
  }
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
})
