import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import AdmZip from 'adm-zip'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {extractLocalZip} from '../zip'

const created: string[] = []
function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
  created.length = 0
})

describe('extractLocalZip', () => {
  it('extracts a real local .zip into <target>/<basename>', async () => {
    const root = makeTempDir('extjs-zip-ok-')
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from('{"name":"x"}'))
    const zipPath = path.join(root, 'my-extension.zip')
    zip.writeZip(zipPath)

    const target = makeTempDir('extjs-zip-out-')
    const dest = await extractLocalZip(zipPath, target)

    expect(dest).toBe(path.join(target, 'my-extension'))
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true)
  })

  it('rejects an HTML login page disguised as a .zip with a clear message', async () => {
    const root = makeTempDir('extjs-zip-html-')
    const zipPath = path.join(root, 'login.zip')
    fs.writeFileSync(zipPath, '<!DOCTYPE html><html>Sign in to Slack</html>')

    const target = makeTempDir('extjs-zip-html-out-')
    await expect(extractLocalZip(zipPath, target)).rejects.toThrow(
      /not a ZIP archive/i
    )
  })

  it('rejects a missing file', async () => {
    const target = makeTempDir('extjs-zip-missing-')
    await expect(
      extractLocalZip(path.join(target, 'nope.zip'), target)
    ).rejects.toThrow(/not found/i)
  })
})
