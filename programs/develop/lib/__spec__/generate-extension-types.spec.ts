import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  EXTENSION_ENV_WILDCARD_MODULES,
  renderExtensionEnvTypes
} from '../extension-env-template'
import {generateExtensionTypes} from '../generate-extension-types'

const publishedTypesFile = path.resolve(
  __dirname,
  '../../../extension/types/assets.d.ts'
)

function wildcardPatternsIn(source: string) {
  return [...source.matchAll(/^declare module '(\*[^']+)'/gm)].map(
    (match) => match[1]
  )
}

const created: string[] = []
function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
  created.length = 0
})

describe('generate-extension-types', () => {
  it('writes extension-env.d.ts in package json dir', async () => {
    const root = makeTempDir('extjs-gen-types-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )
    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-env.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain('reference types="extension/types"')
    expect(content).toContain('reference types="extension/types/polyfill"')
  })

  it('emits the wildcard asset and stylesheet declares beside the reference', async () => {
    const root = makeTempDir('extjs-gen-wildcards-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )
    await generateExtensionTypes(root, root)
    const content = fs.readFileSync(
      path.join(root, 'extension-env.d.ts'),
      'utf8'
    )

    // The reference stays so globals like ImportMeta.env keep loading.
    expect(content).toContain('/// <reference types="extension/types" />')
    expect(content).toBe(renderExtensionEnvTypes())

    expect(content).toContain(
      "declare module '*.png' {\n  const content: string\n  export default content\n}"
    )
    expect(content).toContain(
      "declare module '*.css' {\n  const content: Readonly<Record<string, string>>\n  export default content\n}"
    )
    expect(content).toContain(
      "declare module '*.svg' {\n  const content: any\n  export default content\n}"
    )

    // The emitted file stays a script, so the declares are global ambient modules.
    expect(content).not.toMatch(/^(import|export) /m)
    expect(wildcardPatternsIn(content)).toEqual(
      EXTENSION_ENV_WILDCARD_MODULES.map((entry) => entry.pattern)
    )
  })

  it('keeps the emitted wildcard list in step with extension/types/assets.d.ts', () => {
    const published = fs.readFileSync(publishedTypesFile, 'utf8')
    const publishedPatterns = wildcardPatternsIn(published)
    expect(publishedPatterns.length).toBeGreaterThan(0)
    expect(wildcardPatternsIn(renderExtensionEnvTypes())).toEqual(
      publishedPatterns
    )
  })

  it.skip('writes extension-paths.d.ts with unions', async () => {
    const root = makeTempDir('extjs-gen-paths-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )
    fs.mkdirSync(path.join(root, 'public'), {recursive: true})
    fs.writeFileSync(path.join(root, 'public', 'logo.png'), '')
    fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
    fs.writeFileSync(path.join(root, 'pages', 'home.html'), '')
    fs.mkdirSync(path.join(root, 'scripts'), {recursive: true})
    fs.writeFileSync(path.join(root, 'scripts', 'a.ts'), '')
    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-paths.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain("'public/logo.png'")
    expect(content).toContain("'/public/logo.png'")
    expect(content).toContain("'/logo.png'")
    expect(content).toContain("'pages/home.html'")
    expect(content).toContain("'scripts/a.ts'")
  })
})
