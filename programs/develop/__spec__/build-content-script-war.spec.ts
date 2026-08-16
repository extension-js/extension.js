import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-cs-war-'))

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(name: string, manifestVersion: 2 | 3): string {
  const root = path.join(SUITE_ROOT, name)
  fs.mkdirSync(root, {recursive: true})

  write(
    root,
    'package.json',
    JSON.stringify(
      {
        private: true,
        name: `extjs-build-cs-war-${name}`,
        version: '0.0.0',
        type: 'module'
      },
      null,
      2
    )
  )

  const background =
    manifestVersion === 3
      ? {background: {service_worker: 'src/background.js'}}
      : {background: {scripts: ['src/background.js']}}

  write(
    root,
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: manifestVersion,
        name: `Build Spec, content-script WAR ${name}`,
        version: '1.0.0',
        ...background,
        content_scripts: [
          {
            matches: ['https://ocr.example/*'],
            js: ['src/content.js']
          }
        ]
      },
      null,
      2
    )
  )

  write(
    root,
    'src/content.js',
    [
      'const bundledCore = new URL("./local-ocr.wasm", import.meta.url)',
      'fetch(chrome.runtime.getURL("ocr-core.wasm"))',
      'fetch(chrome.runtime.getURL("ocr-weights.bin"))',
      'console.log("ocr payloads", bundledCore.href)',
      ''
    ].join('\n')
  )

  write(
    root,
    'src/background.js',
    [
      'const secret = new URL("./worker-secret.wasm", import.meta.url)',
      'fetch(chrome.runtime.getURL("worker-model.bin"))',
      'console.log("worker model", secret.href)',
      ''
    ].join('\n')
  )

  // Tiny stand-ins: the bytes only need to survive emit, not execute.
  write(root, 'public/ocr-core.wasm', Buffer.from('ocr-core-wasm'))
  write(root, 'public/ocr-weights.bin', Buffer.from('ocr-weights'))
  write(root, 'public/worker-model.bin', Buffer.from('worker-model'))
  write(root, 'src/local-ocr.wasm', Buffer.from('local-ocr-wasm'))
  write(root, 'src/worker-secret.wasm', Buffer.from('worker-secret-wasm'))

  return root
}

async function buildFixture(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

function readBuiltManifest(root: string) {
  const distDir = path.join(root, 'dist', 'chrome')
  const manifestPath = path.join(distDir, 'manifest.json')
  expect(fs.existsSync(manifestPath), `missing ${manifestPath}`).toBe(true)
  return {
    distDir,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      manifest_version: number
      background?: {service_worker?: string; scripts?: string[]}
      content_scripts?: Array<{js?: string[]}>
      web_accessible_resources?:
        | string[]
        | Array<{resources: string[]; matches: string[]}>
    }
  }
}

function firstDeclaredScript(
  distDir: string,
  scripts: string[] | undefined,
  fallback: string
) {
  const rel = scripts?.[0] || fallback
  const abs = path.join(distDir, rel)
  expect(fs.existsSync(abs), `missing ${abs}`).toBe(true)
  return abs
}

function warResources(manifest: {
  manifest_version: number
  web_accessible_resources?:
    | string[]
    | Array<{resources: string[]; matches: string[]}>
}): string[] {
  const war = manifest.web_accessible_resources
  if (!war) return []
  if (manifest.manifest_version === 2) {
    return Array.isArray(war) && typeof war[0] === 'string'
      ? (war as string[])
      : []
  }
  return (war as Array<{resources: string[]}>).flatMap(
    (group) => group.resources || []
  )
}

function warMatchesFor(
  manifest: {
    web_accessible_resources?: Array<{resources: string[]; matches: string[]}>
  },
  resource: string
): string[] {
  const war = manifest.web_accessible_resources || []
  return war
    .filter((group) => group.resources?.includes(resource))
    .flatMap((group) => group.matches || [])
}

function listRootPayloads(distDir: string, ext: string) {
  return fs
    .readdirSync(distDir)
    .filter((name) => name.endsWith(ext))
    .sort()
}

function referencedFrom(filePath: string, candidates: string[]) {
  const source = fs.readFileSync(filePath, 'utf8')
  return candidates.filter((name) => source.includes(name))
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('build: content-script runtime payloads are web-accessible (real rspack)', () => {
  it("production MV3: content-script wasm/weights are WAR-reachable on that script's pages, worker model is not", async () => {
    const root = writeFixture('mv3-prod', 3)
    const summary = await buildFixture(root, 'production')
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readBuiltManifest(root)
    expect(fs.existsSync(path.join(distDir, 'ocr-core.wasm'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'ocr-weights.bin'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'worker-model.bin'))).toBe(true)

    const resources = warResources(manifest)
    expect(resources).toContain('ocr-core.wasm')
    expect(resources).toContain('ocr-weights.bin')
    expect(resources).not.toContain('worker-model.bin')

    expect(warMatchesFor(manifest, 'ocr-core.wasm')).toEqual([
      'https://ocr.example/*'
    ])
    expect(warMatchesFor(manifest, 'ocr-weights.bin')).toEqual([
      'https://ocr.example/*'
    ])

    const contentJs = firstDeclaredScript(
      distDir,
      manifest.content_scripts?.[0]?.js,
      path.join('content_scripts', 'content-0.js')
    )
    const backgroundJs = firstDeclaredScript(
      distDir,
      manifest.background?.service_worker
        ? [manifest.background.service_worker]
        : undefined,
      path.join('background', 'service_worker.js')
    )

    const rootWasm = listRootPayloads(distDir, '.wasm')
    const contentWasm = referencedFrom(contentJs, rootWasm)
    const backgroundWasm = referencedFrom(backgroundJs, rootWasm)

    expect(contentWasm.length).toBeGreaterThan(0)
    for (const name of contentWasm) {
      expect(resources).toContain(name)
      expect(warMatchesFor(manifest, name)).toEqual(['https://ocr.example/*'])
    }
    for (const name of backgroundWasm) {
      if (!contentWasm.includes(name)) {
        expect(resources).not.toContain(name)
      }
    }
  }, 120_000)

  it('production MV2: the same content-script payloads ship in the flat WAR list, worker model stays private', async () => {
    const root = writeFixture('mv2-prod', 2)
    const summary = await buildFixture(root, 'production')
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readBuiltManifest(root)
    const resources = warResources(manifest)

    expect(resources).toContain('ocr-core.wasm')
    expect(resources).toContain('ocr-weights.bin')
    expect(resources).not.toContain('worker-model.bin')

    const contentJs = firstDeclaredScript(
      distDir,
      manifest.content_scripts?.[0]?.js,
      path.join('content_scripts', 'content-0.js')
    )
    const backgroundJs = firstDeclaredScript(
      distDir,
      manifest.background?.scripts,
      path.join('background', 'scripts.js')
    )
    const rootWasm = listRootPayloads(distDir, '.wasm')
    const contentWasm = referencedFrom(contentJs, rootWasm)
    const backgroundWasm = referencedFrom(backgroundJs, rootWasm)

    expect(contentWasm.length).toBeGreaterThan(0)
    for (const name of contentWasm) {
      expect(resources).toContain(name)
    }
    for (const name of backgroundWasm) {
      if (!contentWasm.includes(name)) {
        expect(resources).not.toContain(name)
      }
    }
  }, 120_000)

  it('development MV3: wasm and weights are reachable even though only images/styles have blanket WAR', async () => {
    const root = writeFixture('mv3-dev', 3)
    const summary = await buildFixture(root, 'development')
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readBuiltManifest(root)
    const resources = warResources(manifest)

    expect(resources).toContain('ocr-core.wasm')
    expect(resources).toContain('ocr-weights.bin')
    expect(resources).not.toContain('worker-model.bin')
    expect(warMatchesFor(manifest, 'ocr-core.wasm')).toContain(
      'https://ocr.example/*'
    )

    const contentJs = firstDeclaredScript(
      distDir,
      manifest.content_scripts?.[0]?.js,
      path.join('content_scripts', 'content-0.js')
    )
    const rootWasm = listRootPayloads(distDir, '.wasm')
    const contentWasm = referencedFrom(contentJs, rootWasm)
    expect(contentWasm.length).toBeGreaterThan(0)
    for (const name of contentWasm) {
      expect(resources).toContain(name)
    }
  }, 120_000)

  it('development MV2: the same content-script payloads stay reachable', async () => {
    const root = writeFixture('mv2-dev', 2)
    const summary = await buildFixture(root, 'development')
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readBuiltManifest(root)
    const resources = warResources(manifest)

    expect(resources).toContain('ocr-core.wasm')
    expect(resources).toContain('ocr-weights.bin')
    expect(resources).not.toContain('worker-model.bin')

    const contentJs = firstDeclaredScript(
      distDir,
      manifest.content_scripts?.[0]?.js,
      path.join('content_scripts', 'content-0.js')
    )
    const rootWasm = listRootPayloads(distDir, '.wasm')
    const contentWasm = referencedFrom(contentJs, rootWasm)
    expect(contentWasm.length).toBeGreaterThan(0)
    for (const name of contentWasm) {
      expect(resources).toContain(name)
    }
  }, 120_000)
})
