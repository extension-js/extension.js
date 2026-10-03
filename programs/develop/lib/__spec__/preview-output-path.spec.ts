import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {computePreviewOutputPath} from '../paths'
import type {ProjectStructure} from '../project'

const roots: string[] = []

function project(withPackageJson: boolean, built: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preview-out-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}')

  if (withPackageJson) {
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
  }

  if (built) {
    fs.mkdirSync(path.join(root, 'dist', 'chromium'), {recursive: true})
    fs.writeFileSync(path.join(root, 'dist', 'chromium', 'manifest.json'), '{}')
  }

  const struct = {
    manifestPath: path.join(root, 'manifest.json'),
    packageJsonPath: withPackageJson
      ? path.join(root, 'package.json')
      : undefined
  } as unknown as ProjectStructure

  return {root, struct}
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('computePreviewOutputPath', () => {
  it('previews the build of a plain manifest project once it exists', () => {
    const {root, struct} = project(false, true)

    expect(computePreviewOutputPath(struct, 'chromium')).toBe(
      path.join(root, 'dist', 'chromium')
    )
  })

  it('falls back to the source directory when nothing was built', () => {
    const {root, struct} = project(false, false)

    expect(computePreviewOutputPath(struct, 'chromium')).toBe(root)
  })

  it('reads the build the same way when a package.json names the root', () => {
    const {root, struct} = project(true, true)

    expect(computePreviewOutputPath(struct, 'chromium')).toBe(
      path.join(root, 'dist', 'chromium')
    )

    expect(computePreviewOutputPath(struct, 'firefox')).toBe(root)
  })

  it('always honors an explicit output path', () => {
    const {struct} = project(false, true)
    const elsewhere = path.join(os.tmpdir(), 'extjs-elsewhere')

    expect(computePreviewOutputPath(struct, 'chromium', elsewhere)).toBe(
      elsewhere
    )
  })
})
