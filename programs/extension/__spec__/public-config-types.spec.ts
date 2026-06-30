import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Guards the public `import('extension').FileConfig` contract (issue #468).
//
// The failure modes here are silent: a `types` path pointing at a missing file,
// or a relative re-export that loses its explicit `.js` extension, both resolve
// to `any` under the common `skipLibCheck: true` instead of erroring. These
// assertions fail loudly when the wiring regresses.

const pkgRoot = path.resolve(__dirname, '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
)

describe('public config types (extension package)', () => {
  it('the root types entry exists and is consistent across fields', () => {
    const rootTypes = pkg.exports['.'].types
    expect(rootTypes).toBe(pkg.types)
    expect(fs.existsSync(path.join(pkgRoot, rootTypes))).toBe(true)
  })

  it('the root declaration re-exports FileConfig with an explicit extension', () => {
    const rootTypes = pkg.exports['.'].types
    const dts = fs.readFileSync(path.join(pkgRoot, rootTypes), 'utf8')

    expect(dts).toContain('FileConfig')
    // ESM (`"type": "module"`): the relative re-export must carry an explicit
    // extension or it resolves to `any` under node16/nodenext (TS2834).
    expect(dts).toMatch(/from\s+['"]\.\/config-types\.js['"]/)
  })

  it('the re-export target declares FileConfig', () => {
    const rootTypes = pkg.exports['.'].types
    const targetDts = path
      .join(pkgRoot, path.dirname(rootTypes), 'config-types.js')
      .replace(/\.js$/, '.d.ts')

    expect(fs.existsSync(targetDts)).toBe(true)
    expect(fs.readFileSync(targetDts, 'utf8')).toMatch(
      /export\s+(interface|type)\s+FileConfig\b/
    )
  })

  it('the source module exports FileConfig from config-types', () => {
    const configTypes = fs.readFileSync(
      path.join(pkgRoot, 'config-types.ts'),
      'utf8'
    )
    expect(configTypes).toMatch(/export\s+interface\s+FileConfig\b/)
  })
})
