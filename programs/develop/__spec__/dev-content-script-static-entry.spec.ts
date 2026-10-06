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

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-static-entry-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'static-entry', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'relay.js'),
    'console.log("static-entry-token:relay")\n'
  )

  fs.writeFileSync(
    path.join(root, 'hook.js'),
    'console.log("static-entry-token:hook")\n'
  )

  fs.writeFileSync(
    path.join(root, 'widget.js'),
    'console.log("static-entry-token:widget")\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'static-entry',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {
          matches: ['https://relay.example/*'],
          js: ['relay.js'],
          run_at: 'document_start',
          all_frames: true
        },
        {
          matches: ['https://hook.example/*'],
          js: ['hook.js'],
          run_at: 'document_start',
          world: 'MAIN'
        },
        {matches: ['https://widget.example/*'], js: ['widget.js']}
      ]
    })
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

describe('a document_start isolated content script during extension dev', () => {
  it('stays in the dev manifest as emitted while the other entries become stubs', async () => {
    const root = project()
    const {distPath, stats} = await compileOnce(root)
    expect(
      Array.from(stats.compilation.errors || []).map((error) =>
        String((error as Error)?.message || error)
      )
    ).toEqual([])

    const manifest = JSON.parse(
      fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf8')
    )
    const groups = manifest.content_scripts as Array<{
      js: string[]
      run_at?: string
      world?: string
      all_frames?: boolean
    }>
    expect(groups.map((group) => group.js)).toEqual([
      [expect.stringMatching(/^content_scripts\/content-0\.[a-f0-9]+\.js$/)],
      [expect.stringMatching(/^content_scripts\/content-3\.[a-f0-9]+\.js$/)],
      ['content_scripts/dev-stub-1.js'],
      ['content_scripts/dev-stub-2.js']
    ])

    expect(groups[0]).toMatchObject({
      run_at: 'document_start',
      all_frames: true
    })

    expect(
      fs.readFileSync(path.join(distPath, groups[0].js[0]), 'utf8')
    ).toContain('static-entry-token:relay')

    expect(groups[1]).toMatchObject({run_at: 'document_start'})
    expect(groups[1].world).toBeUndefined()
    expect(
      fs.readFileSync(path.join(distPath, groups[1].js[0]), 'utf8')
    ).toContain('EXTJS_WTW_LOAD')

    const folder = path.join(distPath, 'content_scripts')
    expect(
      fs
        .readdirSync(folder)
        .filter((name) => /^dev-stub-\d+\.js$/.test(name))
        .sort()
    ).toEqual(['dev-stub-1.js', 'dev-stub-2.js'])

    const registry = JSON.parse(
      fs.readFileSync(path.join(folder, 'dev-registry.json'), 'utf8')
    )
    expect(
      registry.entries.map((entry: Record<string, unknown>) => [
        entry.entry,
        entry.world,
        entry.runAt,
        entry.static
      ])
    ).toEqual([
      ['content_scripts/content-0', 'ISOLATED', 'document_start', true],
      ['content_scripts/content-3', 'ISOLATED', 'document_start', true],
      ['content_scripts/content-1', 'MAIN', 'document_start', undefined],
      ['content_scripts/content-2', 'ISOLATED', 'document_idle', undefined]
    ])

    expect(registry.entries[0].js).toEqual(groups[0].js)
    expect(registry.entries[1].js).toEqual(groups[1].js)
  }, 120_000)
})
