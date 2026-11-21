import * as fs from 'node:fs'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {describe, expect, it, vi} from 'vitest'
import {getDirs} from '../lib/paths'
import {getProjectStructure} from '../lib/project'
import {resolveSessionProjectRoot} from '../lib/session-project-root'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

// The folder a command is pointed at is the project root whether or not a
// package.json sits in it. Without one, a manifest found in src/ once took
// the root with it, so the build, its state and its zips landed in src/dist.
const tempFolder = trackTempFolders()

type Layout = {manifestIn: 'src' | 'root'; packageJson: boolean}

function project(layout: Layout): string {
  const root = fs.realpathSync(tempFolder('extjs-root-no-package-'))
  const sourceDir = layout.manifestIn === 'src' ? path.join(root, 'src') : root

  fs.mkdirSync(sourceDir, {recursive: true})
  fs.writeFileSync(
    path.join(sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Root Probe',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(
    path.join(sourceDir, 'background.js'),
    'console.log("root-probe-background")\n'
  )

  if (layout.packageJson) {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({private: true, name: 'root-probe', version: '0.0.0'})
    )
  }

  return root
}

async function build(root: string, extra: Record<string, unknown> = {}) {
  return await buildProject(root, {
    browser: 'chromium',
    mode: 'production',
    exitOnError: false,
    ...extra
  })
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return []

  return (fs.readdirSync(dir, {recursive: true}) as string[])
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
    .sort()
}

describe('the output root of a project with and without a package.json', () => {
  const layouts: Layout[] = [
    {manifestIn: 'src', packageJson: false},
    {manifestIn: 'src', packageJson: true},
    {manifestIn: 'root', packageJson: false},
    {manifestIn: 'root', packageJson: true}
  ]

  for (const layout of layouts) {
    const name = `a manifest in ${layout.manifestIn} ${layout.packageJson ? 'with' : 'without'} a package.json`

    it(`writes dist at the named folder for ${name}`, async () => {
      const root = project(layout)
      const sourceDir =
        layout.manifestIn === 'src' ? path.join(root, 'src') : root

      await build(root)

      expect({
        manifest: fs.existsSync(
          path.join(root, 'dist', 'chromium', 'manifest.json')
        ),
        state: fs.existsSync(path.join(root, 'dist', 'extension-js')),
        source: fs
          .readdirSync(sourceDir)
          .filter((entry) => entry !== 'dist' || sourceDir !== root)
          .sort()
      }).toEqual({
        manifest: true,
        state: true,
        source: [
          'background.js',
          'manifest.json',
          ...(layout.manifestIn === 'root' && layout.packageJson
            ? ['package.json']
            : [])
        ]
      })
    })
  }

  it('puts the zips under dist at the named folder', async () => {
    const root = project({manifestIn: 'src', packageJson: false})

    await build(root, {zip: true, zipSource: true})

    expect(
      filesUnder(path.join(root, 'dist')).filter((entry) =>
        entry.endsWith('.zip')
      )
    ).toEqual(['root-probe-1.0.0-chromium.zip', 'root-probe-1.0.0-source.zip'])

    expect(fs.readdirSync(path.join(root, 'src')).sort()).toEqual([
      'background.js',
      'manifest.json'
    ])
  })

  it('gives the session readers the same root as the build', async () => {
    const root = project({manifestIn: 'src', packageJson: false})
    const structure = await getProjectStructure(root)

    expect({
      build: getDirs(structure).packageJsonDir,
      readers: resolveSessionProjectRoot(root),
      namedSrc: resolveSessionProjectRoot(path.join(root, 'src'))
    }).toEqual({
      build: root,
      readers: root,
      // Pointed at src itself, the manifest sits in the named folder.
      namedSrc: path.join(root, 'src')
    })
  })
})

describe('a named folder inside a project that does not own it', () => {
  it('builds at the named folder and says which folder is the root', async () => {
    const host = fs.realpathSync(tempFolder('extjs-root-stranger-'))
    const named = path.join(host, 'ext')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    fs.writeFileSync(
      path.join(host, 'package.json'),
      JSON.stringify({private: true, name: 'host', version: '0.0.0'})
    )

    fs.mkdirSync(path.join(named, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(named, 'src', 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Nested', version: '1.0.0'})
    )

    try {
      await build(named, {silent: false})

      expect({
        named: fs.existsSync(
          path.join(named, 'dist', 'chromium', 'manifest.json')
        ),
        besideManifest: fs.existsSync(path.join(named, 'src', 'dist')),
        host: fs.existsSync(path.join(host, 'dist')),
        said: log.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes('as the project root'))
          .map((line) => /Using (\S+) as the project root/.exec(line)?.[1])
      }).toEqual({
        named: true,
        besideManifest: false,
        host: false,
        said: ['ext/']
      })
    } finally {
      log.mockRestore()
    }
  })
})

describe('output an earlier build left beside the manifest', () => {
  function plantOldOutput(root: string) {
    const old = path.join(root, 'src', 'dist')

    fs.mkdirSync(path.join(old, 'chromium', 'pages'), {recursive: true})
    fs.mkdirSync(path.join(old, 'extension-js'), {recursive: true})
    fs.writeFileSync(
      path.join(old, 'chromium', 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Old', version: '0.0.1'})
    )

    fs.writeFileSync(path.join(old, 'chromium', 'old-marker.js'), '// old\n')
    fs.writeFileSync(
      path.join(old, 'chromium', 'pages', 'old-page.html'),
      '<!doctype html><title>old</title>'
    )

    fs.writeFileSync(path.join(old, 'root-probe-0.0.1-chromium.zip'), 'zip')

    return old
  }

  it('leaves the old folder alone and keeps it out of the new build', async () => {
    const root = project({manifestIn: 'src', packageJson: false})
    const old = plantOldOutput(root)
    const before = filesUnder(old)

    await build(root, {zip: true, zipSource: false})

    const built = filesUnder(path.join(root, 'dist', 'chromium'))

    expect({
      old: filesUnder(old),
      carried: built.filter((entry) => /old-|^dist\/|\.zip$/.test(entry)),
      manifestName: JSON.parse(
        fs.readFileSync(
          path.join(root, 'dist', 'chromium', 'manifest.json'),
          'utf8'
        )
      ).name
    }).toEqual({old: before, carried: [], manifestName: 'Root Probe'})
  })

  it('keeps the old folder out of a source zip', async () => {
    const root = project({manifestIn: 'src', packageJson: false})
    const old = plantOldOutput(root)

    fs.mkdirSync(path.join(old, 'extension-js', 'profiles', 'dev'), {
      recursive: true
    })

    fs.writeFileSync(
      path.join(old, 'extension-js', 'profiles', 'dev', 'Cookies'),
      'session'
    )

    await build(root, {zip: true, zipSource: true})

    const sourceZip = unzipSync(
      new Uint8Array(
        fs.readFileSync(path.join(root, 'dist', 'root-probe-1.0.0-source.zip'))
      )
    )

    expect(Object.keys(sourceZip).sort()).toEqual([
      'src/background.js',
      'src/manifest.json'
    ])
  })

  it('says once that the old folder is no longer written', async () => {
    const root = project({manifestIn: 'src', packageJson: false})
    const old = plantOldOutput(root)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await build(root, {silent: false})
      await build(root, {silent: false})

      const notices = log.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('no longer written'))

      expect(notices).toHaveLength(1)
      expect(notices[0]).toContain(old)
      expect(notices[0]).toContain(path.join(root, 'dist'))
      expect(notices[0]).toContain('can be removed')
    } finally {
      log.mockRestore()
    }
  })

  it('stays quiet about a dist folder no build wrote', async () => {
    const root = project({manifestIn: 'src', packageJson: false})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    fs.mkdirSync(path.join(root, 'src', 'dist', 'vendor'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'src', 'dist', 'vendor', 'lib.js'),
      'export const kept = true\n'
    )

    try {
      await build(root, {silent: false})

      expect(
        log.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes('no longer written'))
      ).toEqual([])
    } finally {
      log.mockRestore()
    }
  })
})

describe('a manifest found deeper below the named folder', () => {
  it('writes dist at the named folder and zips the source from there', async () => {
    const root = fs.realpathSync(tempFolder('extjs-root-deep-'))
    const deep = path.join(root, 'apps', 'web', 'ext')

    fs.mkdirSync(deep, {recursive: true})
    fs.writeFileSync(
      path.join(deep, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Deep Probe',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      })
    )

    fs.writeFileSync(path.join(deep, 'background.js'), 'console.log("deep")\n')

    await build(root, {zip: true, zipSource: true})

    const sourceZip = unzipSync(
      new Uint8Array(
        fs.readFileSync(path.join(root, 'dist', 'deep-probe-1.0.0-source.zip'))
      )
    )

    expect({
      manifest: fs.existsSync(
        path.join(root, 'dist', 'chromium', 'manifest.json')
      ),
      zips: filesUnder(path.join(root, 'dist')).filter((entry) =>
        entry.endsWith('.zip')
      ),
      besideManifest: fs.readdirSync(deep).sort(),
      between: fs.readdirSync(path.join(root, 'apps', 'web')),
      source: Object.keys(sourceZip).sort()
    }).toEqual({
      manifest: true,
      zips: ['deep-probe-1.0.0-chromium.zip', 'deep-probe-1.0.0-source.zip'],
      besideManifest: ['background.js', 'manifest.json'],
      between: ['ext'],
      source: ['apps/web/ext/background.js', 'apps/web/ext/manifest.json']
    })
  })
})
