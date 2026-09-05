import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  findNearestPackageJson,
  findNearestPackageJsonSync
} from '../package-json'

// A remote URL reaches the walk-up as a relative path whose ancestry ends at
// "." rather than the filesystem root. 4.1.13 looped there forever.
const remoteManifest = path.join(
  'https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder',
  'manifest.json'
)

describe('findNearestPackageJson', () => {
  it('returns null for a URL-shaped path instead of walking forever', () => {
    expect(findNearestPackageJsonSync(remoteManifest)).toBeNull()
  })

  it('async variant returns null for a URL-shaped path as well', async () => {
    await expect(findNearestPackageJson(remoteManifest)).resolves.toBeNull()
  })

  it('still finds the package.json above a nested manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pkgjson-'))
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"probe"}')
    fs.mkdirSync(path.join(dir, 'src'))
    expect(
      findNearestPackageJsonSync(path.join(dir, 'src', 'manifest.json'))
    ).toBe(path.join(dir, 'package.json'))
  })
})
