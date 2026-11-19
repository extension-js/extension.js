import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {findNearestPackageJsonSync} from '../package-json'

const makeTempFolder = trackTempFolders()

// A remote URL reaches the walk-up as a relative path whose ancestry ends at
// "." rather than the filesystem root. 4.1.13 looped there forever.
const remoteManifest = path.join(
  'https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder',
  'manifest.json'
)

describe('findNearestPackageJsonSync', () => {
  it('returns null for a URL-shaped path instead of walking forever', () => {
    expect(findNearestPackageJsonSync(remoteManifest)).toBeNull()
  })

  it('still finds the package.json above a nested manifest', () => {
    const dir = makeTempFolder('extjs-pkgjson-')
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"probe"}')
    fs.mkdirSync(path.join(dir, 'src'))
    expect(
      findNearestPackageJsonSync(path.join(dir, 'src', 'manifest.json'))
    ).toBe(path.join(dir, 'package.json'))
  })
})
