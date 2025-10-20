import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {generateExtensionTypes} from '../develop-lib/generate-extension-types'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

describe('generate-extension-types', () => {
  it('writes extension-env.d.ts in package json dir', async () => {
    const root = makeTempDir('extjs-gen-types-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )
    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-env.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain('reference types="extension/types"')
  })
})
