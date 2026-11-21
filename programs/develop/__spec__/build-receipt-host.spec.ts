import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'

// A build is no dev session, so its receipt names no dev server host, and
// least of all the one a session in the same host process is listening on.
const tempFolder = trackTempFolders()

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function project() {
  const root = fs.realpathSync(tempFolder('extjs-receipt-host-'))

  writeExtensionProject(root, {
    name: 'receipt-host',
    manifest: {background: {service_worker: 'background.js'}}
  })

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log(1)\n')

  return root
}

describe('the receipt of a build beside a dev session', () => {
  it('does not name the host the session wrote to the environment', async () => {
    vi.stubEnv('EXTENSION_DEV_SERVER_CONNECTABLE_HOST', 'devbox.example.com')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const root = project()

    await buildProject(root, {mode: 'production'})

    const receipt = fs.readFileSync(
      path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json'),
      'utf8'
    )

    expect(receipt).not.toContain('devbox.example.com')
  }, 120_000)
})
