import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {describe, it, expect, afterEach} from 'vitest'
import * as messages from '../messages'

function makeTempProject(name = 'Msg Build'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-msg-'))
  const manifestPath = path.join(root, 'manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({name, version: '1.2.3', manifest_version: 3})
  )
  return root
}

describe('messages.buildWebpack smoke', () => {
  let temp: string | undefined
  afterEach(() => {
    if (temp) {
      try {
        fs.rmSync(temp, {recursive: true, force: true})
      } catch {}
      temp = undefined
    }
  })

  it('includes extension name, version, browser and status', () => {
    temp = makeTempProject('Hello World Extension')
    const fakeStats = {
      toJson: () => ({
        time: 1234,
        assets: [{name: 'content/foo.js', size: 1000}]
      }),
      hasErrors: () => false
    }
    const out = messages.buildWebpack(temp, fakeStats as any, 'firefox')
    expect(out).toContain('Building')
    expect(out).toMatch(/Hello World Extension/i)
    expect(out).toMatch(/Firefox/i)
    expect(out).toMatch(/Build Status:/)
    expect(out).toMatch(/Success/i)
    expect(out).toMatch(/Version:/)
    expect(out).toMatch(/Build completed in/)
  })

  it('buildSuccess emits a ready for deployment line', () => {
    const msg = messages.buildSuccess()
    expect(msg).toMatch(/ready for deployment/i)
  })
})
