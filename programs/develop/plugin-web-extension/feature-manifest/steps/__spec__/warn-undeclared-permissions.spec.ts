// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {WarnUndeclaredPermissions} from '../warn-undeclared-permissions'

// The production build scan, which runs without the dev session's injected
// permissions. A manifest that grants every site already unlocks the tab
// fields "tabs" gates, so recommending "tabs" there only widens the install
// prompt.
describe('WarnUndeclaredPermissions', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-tabs-'))
    file = path.join(dir, 'background.js')
    fs.writeFileSync(
      file,
      "chrome.tabs.query({url: ['http://*/*', 'https://*/*']}, (t) => console.log(t[0].url))\n"
    )
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  const buildWarnings = (manifest: Record<string, unknown>) => {
    const warnings: Array<{name: string; message: string}> = []
    const text = fs.readFileSync(file, 'utf-8')
    const module = {resource: file}
    const compilation = {
      errors: [],
      warnings,
      modules: [module],
      chunkGraph: {
        getModuleChunksIterable: (m: unknown) =>
          m === module ? [{files: ['background.js']}] : []
      },
      getAssets: () => [
        {name: 'manifest.json', source: {source: () => ''}},
        {name: 'background.js', source: {source: () => text}}
      ],
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(manifest)}
          : undefined,
      assets: {'manifest.json': {source: () => JSON.stringify(manifest)}},
      hooks: {processAssets: {tap: (_o: unknown, fn: () => void) => fn()}}
    } as unknown as Compilation
    const compiler = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {
          tap: (_n: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any

    new WarnUndeclaredPermissions({
      manifestPath: path.join(dir, 'manifest.json'),
      browser: 'chrome'
    } as any).apply(compiler)

    return warnings.filter(
      (w) =>
        w.name === 'UndeclaredPermissionWarning' && w.message.includes('"tabs"')
    )
  }

  it('warns about "tabs" when nothing grants the tab fields', () => {
    expect(buildWarnings({manifest_version: 3, name: 'x'})).toHaveLength(1)
  })

  it('stays quiet when host_permissions grant every site', () => {
    expect(
      buildWarnings({
        manifest_version: 3,
        name: 'x',
        permissions: ['storage', 'scripting'],
        host_permissions: ['<all_urls>']
      })
    ).toHaveLength(0)

    expect(
      buildWarnings({
        manifest_version: 3,
        name: 'x',
        host_permissions: ['*://*/*']
      })
    ).toHaveLength(0)
  })

  it('still warns when the hosts cover only some sites or only activeTab is declared', () => {
    expect(
      buildWarnings({
        manifest_version: 3,
        name: 'x',
        host_permissions: ['https://example.com/*']
      })
    ).toHaveLength(1)

    expect(
      buildWarnings({
        manifest_version: 3,
        name: 'x',
        permissions: ['activeTab']
      })
    ).toHaveLength(1)
  })
})
