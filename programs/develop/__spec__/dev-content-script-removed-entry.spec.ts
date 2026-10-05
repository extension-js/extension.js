import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type ContentScript = {matches: string[]; js: string[]}

const first: ContentScript = {
  matches: ['https://first.example/*'],
  js: ['content-first.js']
}
const second: ContentScript = {
  matches: ['https://second.example/*'],
  js: ['content-second.js']
}

function writeManifest(root: string, contentScripts?: ContentScript[]) {
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'removed-entry',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: contentScripts
    })
  )
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-removed-entry-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'removed-entry', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'content-first.js'),
    'console.log("removed-entry-token:first")\n'
  )

  fs.writeFileSync(
    path.join(root, 'content-second.js'),
    'console.log("removed-entry-token:second")\n'
  )

  return root
}

async function compileOnce(root: string) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler: Compiler = rspack(config)

  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      if (error || !result) return reject(error || new Error('no stats'))

      resolve(result)
    })
  })
  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  return {distPath, stats}
}

function readDist(distPath: string) {
  const folder = path.join(distPath, 'content_scripts')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf8')
  )
  const registry = JSON.parse(
    fs.readFileSync(path.join(folder, 'dev-registry.json'), 'utf8')
  )

  return {
    stubs: fs
      .readdirSync(folder)
      .filter((name) => /^dev-stub-\d+\.js$/.test(name))
      .sort(),
    named: (manifest.content_scripts as ContentScript[]).flatMap(
      (group) => group.js
    ),
    registryIds: (registry.entries as Array<{id: string}>).map(
      (entry) => entry.id
    )
  }
}

const errorsOf = (stats: Stats) =>
  Array.from(stats.compilation.errors || []).map((error) =>
    String((error as Error)?.message || error)
  )

describe('a content script removed from the manifest during extension dev', () => {
  it('leaves one stub per registry entry once the session compiler is rebuilt', async () => {
    const root = project()
    writeManifest(root, [first, second])
    const before = await compileOnce(root)
    expect(errorsOf(before.stats)).toEqual([])
    expect(readDist(before.distPath)).toEqual({
      stubs: ['dev-stub-0.js', 'dev-stub-1.js'],
      named: ['content_scripts/dev-stub-0.js', 'content_scripts/dev-stub-1.js'],
      registryIds: ['extjs-dev-cs-0', 'extjs-dev-cs-1']
    })

    writeManifest(root, [first])
    const after = await compileOnce(root)
    expect(errorsOf(after.stats)).toEqual([])
    expect(readDist(after.distPath)).toEqual({
      stubs: ['dev-stub-0.js'],
      named: ['content_scripts/dev-stub-0.js'],
      registryIds: ['extjs-dev-cs-0']
    })
  }, 120_000)

  it('leaves no bundle of the last one once the manifest names none', async () => {
    const root = project()
    const vendor = path.join('content_scripts', 'vendor.0123abcd.js')
    fs.mkdirSync(path.join(root, 'public', 'content_scripts'), {
      recursive: true
    })

    fs.writeFileSync(
      path.join(root, 'public', vendor),
      'console.log("removed-entry-token:vendor")\n'
    )

    writeManifest(root, [first])
    const before = await compileOnce(root)
    const folder = path.join(before.distPath, 'content_scripts')
    const bundlesIn = () =>
      fs.readdirSync(folder).filter((name) => /^content-\d+\./.test(name))

    expect(errorsOf(before.stats)).toEqual([])
    expect(bundlesIn()).toHaveLength(2)
    expect(
      fs.readFileSync(path.join(folder, bundlesIn()[0]), 'utf8')
    ).toContain('removed-entry-token:first')

    writeManifest(root)
    const after = await compileOnce(root)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(after.distPath, 'manifest.json'), 'utf8')
    )

    expect(errorsOf(after.stats)).toEqual([])
    expect(manifest.content_scripts).toBeUndefined()
    expect(bundlesIn()).toEqual([])
    expect(
      fs.readFileSync(path.join(after.distPath, vendor), 'utf8')
    ).toContain('removed-entry-token:vendor')
  }, 120_000)
})
