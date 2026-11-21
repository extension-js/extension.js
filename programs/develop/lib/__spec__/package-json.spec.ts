import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {findNearestPackageJsonSync, readPackageJson} from '../package-json'

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

// A package.json that is there and cannot be opened leaves the project as
// unusable as one that does not parse, so it gets the same code.
describe('readPackageJson on a file that cannot be opened', () => {
  it('refuses a package.json that is a folder with E_PACKAGE_JSON_INVALID, naming the path and the reason', () => {
    const dir = makeTempFolder('extjs-pkgjson-unopened-')
    const file = path.join(dir, 'package.json')

    fs.mkdirSync(file)

    let thrown: (Error & {code?: string}) | undefined

    try {
      readPackageJson(file)
    } catch (error) {
      thrown = error as Error & {code?: string}
    }

    expect(thrown?.code).toBe('E_PACKAGE_JSON_INVALID')
    expect(thrown?.message).toContain("Couldn't open package.json.")
    expect(thrown?.message).toContain(file)
    expect(thrown?.message).toContain('EISDIR')
  })

  it('leaves a missing file to the caller, as the plain error it was', () => {
    const dir = makeTempFolder('extjs-pkgjson-missing-')

    let thrown: (Error & {code?: string}) | undefined

    try {
      readPackageJson(path.join(dir, 'package.json'))
    } catch (error) {
      thrown = error as Error & {code?: string}
    }

    expect(thrown?.code).toBe('ENOENT')
  })
})
