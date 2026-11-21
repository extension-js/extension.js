import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Stats} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  openDevWatchSession
} from '../../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

// A devtools panel is named by a script, not by the manifest. Its page with
// no file is one finding, whenever the file went away: before a production
// build, before the dev session, or while it runs.
const tempFolder = trackTempFolders()

const htmlPage = (script: string) =>
  `<!doctype html><html><body><script src="${script}"></script></body></html>\n`

function project(withPanel: boolean): string {
  const root = fs.realpathSync(tempFolder('extjs-panel-deleted-'))

  const write = (name: string, contents: string) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), contents)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'panel-deleted', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'panel-deleted',
      version: '1.0.0',
      devtools_page: 'devtools.html'
    })
  )

  write('devtools.html', htmlPage('./devtools.js'))
  write(
    'devtools.js',
    "chrome.devtools.panels.create('Panel', '', 'panel/index.html')\n"
  )

  write('panel/panel.js', "console.log('panel')\n")
  if (withPanel) write('panel/index.html', htmlPage('./panel.js'))

  return root
}

interface Finding {
  severity: 'error' | 'warning'
  name: string
  message: string
}

const findingsOf = (stats: Stats): Finding[] => {
  const read = (severity: Finding['severity'], list: Iterable<unknown>) =>
    Array.from(list as Iterable<Error>).map((issue) => ({
      severity,
      name: issue.name,
      message: String(issue.message)
    }))

  return [
    ...read('error', stats.compilation.errors),
    ...read('warning', stats.compilation.warnings)
  ]
}

async function productionFindings(root: string): Promise<Finding[]> {
  const {rspack} = await import('@rspack/core')
  const {getProjectStructure} = await import('../../../../lib/project')
  const {default: webpackConfig} = await import('../../../../rspack-config')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'production',
    metadataCommand: 'build',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  })

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler = rspack(config)

  return new Promise<Finding[]>((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {})
      if (error || !stats) return reject(error)

      resolve(findingsOf(stats))
    })
  })
}

let session: DevWatchSession
let devRoot = ''

beforeAll(async () => {
  devRoot = project(true)
  session = await openDevWatchSession(devRoot)
}, 120000)

afterAll(async () => {
  await session?.close()
})

const shape = (findings: Finding[], root: string) =>
  findings.map((finding) => ({
    ...finding,
    message: finding.message.split(root).join('<root>')
  }))

const severities = (findings: Finding[]) => [
  ...new Set(findings.map((finding) => finding.severity))
]

describe('a devtools panel page with no file', () => {
  it('warns and never fails in production, at dev startup and mid-session', async () => {
    expect(severities(await productionFindings(project(false)))).toEqual([
      'warning'
    ])

    const startup = await openDevWatchSession(project(false))

    try {
      const seen = await startup.settle()

      expect(severities(findingsOf(await startup.doneAfter(seen - 1)))).toEqual(
        ['warning']
      )
    } finally {
      await startup.close()
    }

    const seen = await session.settle()
    fs.rmSync(path.join(devRoot, 'panel', 'index.html'))
    const midSession = shape(
      findingsOf(await session.doneAfter(seen, 10000)),
      devRoot
    )

    expect(severities(midSession)).toEqual(['warning'])

    // The finding of this step names the file and no manifest field.
    const named = midSession.filter(
      (finding) => finding.name === 'ManifestPageMissing'
    )

    expect(named).toHaveLength(1)
    expect(named[0].message).toContain(
      `NOT FOUND ${path.join('<root>', 'panel', 'index.html')}`
    )

    expect(named[0].message).not.toContain('manifest.json')
  }, 120000)

  it('fails the rebuild over the same page under EXTENSION_STRICT_REFS', async () => {
    const previous = process.env.EXTENSION_STRICT_REFS
    process.env.EXTENSION_STRICT_REFS = 'true'

    try {
      // Any save rebuilds, and the panel page is still gone.
      const seen = await session.settle()
      fs.writeFileSync(
        path.join(devRoot, 'panel', 'panel.js'),
        "console.log('panel again')\n"
      )

      const findings = findingsOf(await session.doneAfter(seen, 10000))

      expect(
        findings
          .filter((finding) => finding.name === 'ManifestPageMissing')
          .map((finding) => finding.severity)
      ).toEqual(['error'])
    } finally {
      if (previous === undefined) delete process.env.EXTENSION_STRICT_REFS
      else process.env.EXTENSION_STRICT_REFS = previous
    }
  }, 60000)
})
