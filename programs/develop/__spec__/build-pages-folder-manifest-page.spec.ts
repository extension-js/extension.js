import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeExtensionProject} from './helpers/extension-project'

const tempFolder = trackTempFolders()

// A page under pages/ that the manifest also names. The folder scan used to
// enter it a second time, so it shipped twice and warned twice.
function project() {
  const root = tempFolder('extjs-pages-owned-')
  fs.mkdirSync(path.join(root, 'pages', 'about'), {recursive: true})
  fs.mkdirSync(path.join(root, 'pages', 'help'), {recursive: true})
  writeExtensionProject(root, {
    name: 'pages-owned',
    manifest: {action: {default_popup: '/pages/about/about.html'}}
  })

  fs.writeFileSync(
    path.join(root, 'pages', 'about', 'about.html'),
    [
      '<!doctype html><html><head></head><body>',
      '<img src="/assets/missing.png">',
      '</body></html>'
    ].join('')
  )

  fs.writeFileSync(
    path.join(root, 'pages', 'help', 'help.html'),
    '<!doctype html><html><body>help</body></html>'
  )

  return root
}

async function build(root: string) {
  const summary = await buildProject(root)

  expect(summary.errors_count).toBe(0)

  return summary
}

describe('a manifest page that lives under pages/', () => {
  it('ships once, warns once, and leaves the other pages/ files as entries', async () => {
    const root = project()
    const summary = await build(root)
    const dist = path.join(root, 'dist', 'chrome')
    const files = fs
      .readdirSync(dist, {recursive: true})
      .map((file) => String(file).split(path.sep).join('/'))
      .filter((file) => fs.statSync(path.join(dist, file)).isFile())
      .sort()

    expect(files).toContain('action/index.html')
    expect(files).not.toContain('pages/about/about.html')
    expect(files).toContain('pages/help/help.html')

    const warnings = (summary.warnings || []).map(String)
    const missing = warnings.filter((warning) =>
      warning.includes('assets/missing.png')
    )
    expect(missing, warnings.join('\n---\n')).toHaveLength(1)
  }, 180_000)
})
