import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project() {
  const root = tempFolder('extjs-user-entry-')

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'user-entry', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'user-entry',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'shared.js'),
    'export const shared = "SHARED_MARK_7a1f"\n'
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><body><div id="root"></div><script src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(
    path.join(root, 'popup.js'),
    "import {shared} from './shared.js'\ndocument.getElementById('root').textContent = shared\n"
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    "import {shared} from './shared.js'\nconsole.log(shared)\n"
  )

  fs.mkdirSync(path.join(root, 'changelog'))
  fs.writeFileSync(
    path.join(root, 'changelog', 'changelog.js'),
    "import {shared} from '../shared.js'\ndocument.body.textContent = 'changelog ' + shared\n"
  )

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    [
      'module.exports = {',
      '  config: (config) => ({',
      '    ...config,',
      "    entry: {...config.entry, 'changelog/changelog': './changelog/changelog.js'}",
      '  })',
      '}',
      ''
    ].join('\n')
  )

  return root
}

async function build(root: string) {
  return buildProject(root, {
    mode: 'production'
  })
}

describe('an entry added through the config hook', () => {
  it('ships as one file that carries its shared code', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const extra = fs.readFileSync(
      path.join(distDir, 'changelog', 'changelog.js'),
      'utf8'
    )

    expect(extra).toContain('SHARED_MARK_7a1f')
    expect(extra).not.toContain('shared/commons')
    expect(fs.existsSync(path.join(distDir, 'changelog', 'changelog.js'))).toBe(
      true
    )
  })
})
