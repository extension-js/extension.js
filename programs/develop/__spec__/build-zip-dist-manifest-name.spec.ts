import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
) {
  const root = tempFolder('extjsprobezip')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'zip-probe-pkg', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      action: {default_popup: 'popup.html'},
      ...manifest
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><body><script src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(path.join(root, 'popup.js'), 'console.log("popup")\n')

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content)
  }

  return root
}

async function build(root: string) {
  const summary = await buildProject(root, {mode: 'production', zip: true})
  expect(summary.errors_count).toBe(0)

  const distManifest = JSON.parse(
    fs.readFileSync(path.join(root, 'dist', 'chrome', 'manifest.json'), 'utf8')
  )
  const zips = fs
    .readdirSync(path.join(root, 'dist'))
    .filter((file) => file.endsWith('.zip'))
    .sort()

  return {distManifest, zips}
}

describe('the dist zip is named from the manifest the build emitted', () => {
  it('resolves a name and version that exist only under a vendor prefix', async () => {
    const built = await build(
      project({'chromium:name': 'Zip Probe', 'chromium:version': '2.3.4'})
    )

    expect(built.distManifest.name).toBe('Zip Probe')
    expect(built.distManifest.version).toBe('2.3.4')
    expect(built.zips).toEqual(['zip-probe-2.3.4-chrome.zip'])
  }, 180_000)

  it('resolves values templated from a .env file', async () => {
    const built = await build(
      project(
        {
          name: '$EXTENSION_PUBLIC_APP_NAME',
          version: '$EXTENSION_PUBLIC_APP_VERSION'
        },
        {
          '.env':
            'EXTENSION_PUBLIC_APP_NAME=Env Probe\nEXTENSION_PUBLIC_APP_VERSION=5.6.7\n'
        }
      )
    )

    expect(built.distManifest.name).toBe('Env Probe')
    expect(built.distManifest.version).toBe('5.6.7')
    expect(built.zips).toEqual(['env-probe-5.6.7-chrome.zip'])
  }, 180_000)
})
