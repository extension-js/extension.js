import {describe, it, expect, beforeEach, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {createHash} from 'crypto'

let mockRoot = ''

vi.mock('../check-build-dependencies', () => ({
  findExtensionDevelopRoot: () => mockRoot
}))

function getMarkerPath(projectPath: string, packageRoot: string) {
  const key = createHash('sha1').update(path.resolve(projectPath)).digest('hex')

  return path.join(
    packageRoot,
    '.cache',
    'extensionjs',
    'preflight',
    `${key}.json`
  )
}

describe('preflight-cache', () => {
  beforeEach(() => {
    mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preflight-'))
  })

  it('invalidates marker when dependency hash changes', async () => {
    const projectPath = path.join(mockRoot, 'project')
    fs.mkdirSync(projectPath, {recursive: true})
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({dependencies: {react: '1.0.0'}})
    )

    const {hasPreflightMarker, writePreflightMarker} =
      await import('../preflight-cache')

    expect(hasPreflightMarker(projectPath)).toBe(false)
    writePreflightMarker(projectPath)
    expect(hasPreflightMarker(projectPath)).toBe(true)

    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({dependencies: {react: '2.0.0'}})
    )

    expect(hasPreflightMarker(projectPath)).toBe(false)
  })

  it('clears cache on version mismatch', async () => {
    const projectPath = path.join(mockRoot, 'project')
    fs.mkdirSync(projectPath, {recursive: true})
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({dependencies: {react: '1.0.0'}})
    )

    const cacheDir = path.join(mockRoot, '.cache', 'extensionjs', 'preflight')
    fs.mkdirSync(cacheDir, {recursive: true})
    fs.writeFileSync(
      path.join(cacheDir, 'version.json'),
      JSON.stringify({version: '0.0.0'})
    )
    fs.writeFileSync(
      getMarkerPath(projectPath, mockRoot),
      JSON.stringify({projectPath, depsHash: 'x', version: '0.0.0'})
    )

    const {hasPreflightMarker} = await import('../preflight-cache')

    expect(hasPreflightMarker(projectPath)).toBe(false)
    expect(fs.existsSync(cacheDir)).toBe(false)
  })
})
