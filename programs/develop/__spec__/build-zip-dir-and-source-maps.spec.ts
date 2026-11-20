import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {listOutputFiles} from '../lib/output-files'
import {buildProject} from './helpers/build-project'

// The archive can be placed as well as named, and a production build can
// write source maps that the totals count apart and no zip carries.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(config?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-zip-dir-'))
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'zip-dir',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Zip Dir',
      version: '1.2.3',
      background: {service_worker: 'background.js'}
    }),
    'background.js':
      'const greeting = "ZIP_DIR_BACKGROUND"\nconsole.log(greeting)\n',
    ...(config ? {'extension.config.js': config} : {})
  }

  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), contents)
  }

  return root
}

async function build(root: string, options: Record<string, unknown> = {}) {
  return await buildProject(root, {mode: 'production', ...options})
}

const zipsIn = (dir: string) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith('.zip'))
    : []

describe('extension build --zip-dir', () => {
  it('writes both archives to the folder and keeps the name and browser suffix', async () => {
    const root = project()
    const summary = await build(root, {
      zip: true,
      zipSource: true,
      zipDir: 'release/store',
      zipFilename: 'my-ext-v1'
    })

    expect(summary.errors_count).toBe(0)
    expect(zipsIn(path.join(root, 'release', 'store')).sort()).toEqual([
      'my-ext-v1-chrome.zip',
      'my-ext-v1-source.zip'
    ])

    expect(zipsIn(path.join(root, 'dist'))).toEqual([])
    expect(
      (summary.zip_artifacts || []).map((artifact) =>
        path.relative(root, artifact.path).split(path.sep).join('/')
      )
    ).toEqual([
      'release/store/my-ext-v1-source.zip',
      'release/store/my-ext-v1-chrome.zip'
    ])
  }, 120_000)

  it('leaves the archives of an earlier run out of the source zip', async () => {
    const root = project()
    await build(root, {zip: true, zipSource: true, zipDir: 'release'})
    await build(root, {zip: true, zipSource: true, zipDir: 'release'})

    const entries = Object.keys(
      unzipSync(
        new Uint8Array(
          fs.readFileSync(
            path.join(root, 'release', 'zip-dir-1.2.3-source.zip')
          )
        )
      )
    )

    expect(entries).toContain('background.js')
    expect(entries.filter((name) => name.endsWith('.zip'))).toEqual([])
  }, 120_000)

  it('reads commands.build.zipDir from the project config', async () => {
    const root = project(
      "module.exports = {commands: {build: {zip: true, zipDir: 'out'}}}\n"
    )
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(zipsIn(path.join(root, 'out'))).toEqual(['zip-dir-1.2.3-chrome.zip'])
  }, 120_000)

  it('takes an absolute folder outside the project as written', async () => {
    const root = project()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-zip-out-'))
    roots.push(outside)

    await build(root, {zip: true, zipDir: path.join(outside, 'drop')})

    expect(zipsIn(path.join(outside, 'drop'))).toEqual([
      'zip-dir-1.2.3-chrome.zip'
    ])
  }, 120_000)

  it('refuses a relative folder that leaves the project and a folder inside the build output', async () => {
    const root = project()

    await expect(build(root, {zip: true, zipDir: '../escape'})).rejects.toThrow(
      /--zip-dir.*leaves the project/s
    )

    await expect(
      build(root, {zip: true, zipDir: 'dist/chrome/zips'})
    ).rejects.toThrow(/--zip-dir.*inside the build output/s)

    await expect(build(root, {zip: true, zipDir: '  '})).rejects.toThrow(
      /--zip-dir.*needs a folder path/s
    )

    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
    expect(fs.existsSync(path.join(path.dirname(root), 'escape'))).toBe(false)
  }, 120_000)
})

describe('extension build --source-maps', () => {
  it('writes no map by default and reports no map total', async () => {
    const root = project()
    const summary = await build(root)
    const files = listOutputFiles(path.join(root, 'dist', 'chrome'))

    expect(files.filter((file) => file.name.endsWith('.map'))).toEqual([])
    expect(summary.source_map_bytes).toBeUndefined()
    expect(summary.source_map_assets).toBeUndefined()
  }, 120_000)

  it('writes maps, counts them apart from what ships and keeps them out of the zip', async () => {
    const root = project()
    const summary = await build(root, {sourceMaps: true, zip: true})
    const files = listOutputFiles(path.join(root, 'dist', 'chrome'))
    const maps = files.filter((file) => file.name.endsWith('.map'))
    const shipped = files.filter((file) => !file.name.endsWith('.map'))
    const sum = (list: Array<{size: number}>) =>
      list.reduce((total, file) => total + file.size, 0)

    expect(maps.map((file) => file.name)).toContain(
      'background/service_worker.js.map'
    )

    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, 'dist/chrome/background/service_worker.js.map'),
          'utf8'
        )
      ).sourcesContent.join('\n')
    ).toContain('ZIP_DIR_BACKGROUND')

    expect(summary.total_assets).toBe(shipped.length)
    expect(summary.total_bytes).toBe(sum(shipped))
    expect(summary.largest_asset_bytes).toBe(
      Math.max(...shipped.map((file) => file.size))
    )

    expect(summary.source_map_assets).toBe(maps.length)
    expect(summary.source_map_bytes).toBe(sum(maps))

    const entries = Object.keys(
      unzipSync(
        new Uint8Array(
          fs.readFileSync(path.join(root, 'dist', 'zip-dir-1.2.3-chrome.zip'))
        )
      )
    )

    expect(entries).toContain('background/service_worker.js')
    expect(entries.filter((name) => name.endsWith('.map'))).toEqual([])
  }, 120_000)

  it('reads commands.build.sourceMaps from the project config', async () => {
    const root = project(
      'module.exports = {commands: {build: {sourceMaps: true}}}\n'
    )
    const summary = await build(root)

    expect(summary.source_map_assets).toBeGreaterThan(0)
  }, 120_000)

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'closes a build whose archive cannot be written by naming the folder that was built',
    async () => {
      const root = fs.realpathSync(project())
      const locked = path.join(root, 'locked')
      const said: string[] = []

      fs.mkdirSync(locked)
      fs.chmodSync(locked, 0o555)

      const error = vi
        .spyOn(console, 'error')
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.join(' '))
        })
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await expect(
          build(root, {zip: true, zipDir: 'locked', silent: false})
        ).rejects.toMatchObject({code: 'E_ZIP_SKIPPED'})
      } finally {
        error.mockRestore()
        log.mockRestore()
        fs.chmodSync(locked, 0o755)
      }

      const dist = path.join(root, 'dist', 'chrome')
      const plain = said.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ''))

      expect(plain.at(-1)).toMatch(
        /Build failed with 1 error\. The output folder \S+ is in place and loads as built\.$/
      )

      expect(plain.at(-1)).toContain(path.join('dist', 'chrome'))
      expect(fs.existsSync(path.join(dist, 'manifest.json'))).toBe(true)
    },
    120_000
  )
})
