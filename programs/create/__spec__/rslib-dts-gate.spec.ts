import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {resolveDtsGeneration} from '../../../scripts/lib/dts-generation.mjs'

const broken = () => {
  throw new Error('Cannot find native binding.\nRequire stack: ...')
}

describe('the create build writes type declarations or stops', () => {
  it('generates them when the native parser loads', () => {
    expect(resolveDtsGeneration(() => ({}), {})).toBe(true)
  })

  it('stops the build when the native parser cannot load', () => {
    expect(() => resolveDtsGeneration(broken, {})).toThrow(
      /Type declarations cannot be generated: @ast-grep\/napi failed to load\.\nCannot find native binding\.\nReinstall the dependencies, or set EXTENSION_SKIP_DTS=1/
    )
  })

  it('builds without them only when asked to, and never tries the parser then', () => {
    expect(resolveDtsGeneration(broken, {EXTENSION_SKIP_DTS: '1'})).toBe(false)
    expect(() =>
      resolveDtsGeneration(broken, {EXTENSION_SKIP_DTS: 'true'})
    ).toThrow()
  })

  // The config runs the rule as it loads, so its source is what a spec can
  // hold without starting a build.
  it('decides through that rule alone, with no quiet way to skip', () => {
    const config = fs.readFileSync(
      path.resolve(__dirname, '..', 'rslib.config.ts'),
      'utf8'
    )

    expect(config).toContain(
      "const shouldGenerateDts = resolveDtsGeneration(() => require('@ast-grep/napi'))"
    )

    expect(config).toContain('dts: shouldGenerateDts')
    expect(config).not.toContain('Skipping d.ts generation')
    expect(config).not.toContain('console.warn')
  })
})
