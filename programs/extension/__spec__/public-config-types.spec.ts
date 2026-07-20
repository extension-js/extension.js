import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

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
