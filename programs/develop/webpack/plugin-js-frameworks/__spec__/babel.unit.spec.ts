import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as babelMod from '../js-tools/babel'

const realEnv = process.env.EXTENSION_ENV

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'babel-spec-'))
}

describe('js-tools/babel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    process.env.EXTENSION_ENV = realEnv
    vi.restoreAllMocks()
  })

  it('isUsingBabel returns false when no package.json exists', () => {
    const tmp = createTempDir()
    const result = babelMod.isUsingBabel(tmp)
    expect(result).toBe(false)
  })

  it('isUsingBabel returns true when a babel config file is present', () => {
    const tmp = createTempDir()
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(tmp, '.babelrc'), '{}', 'utf8')
    const result = babelMod.isUsingBabel(tmp)
    expect(result).toBe(true)
  })

  it('isUsingBabel returns true when babel-core dependency exists', () => {
    const tmp = createTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({dependencies: {'babel-core': '^7.0.0'}}),
      'utf8'
    )
    const result = babelMod.isUsingBabel(tmp)
    expect(result).toBe(true)
  })

  it('getBabelConfigFile returns first found babel config file', () => {
    const tmp = createTempDir()
    fs.writeFileSync(
      path.join(tmp, '.babelrc.cjs'),
      'module.exports={}',
      'utf8'
    )
    const config = babelMod.getBabelConfigFile(tmp)
    expect(config).toBe(path.join(tmp, '.babelrc.cjs'))
  })

  it('babelConfig returns compact in production and configFile value', () => {
    const tmp = createTempDir()
    fs.writeFileSync(
      path.join(tmp, 'babel.config.json'),
      JSON.stringify({}),
      'utf8'
    )
    const prod = babelMod.babelConfig(tmp, {
      mode: 'production',
      typescript: false
    })
    expect(prod.compact).toBe(true)
    expect(prod.configFile).toBe(path.join(tmp, 'babel.config.json'))

    const dev = babelMod.babelConfig(tmp, {
      mode: 'development',
      typescript: true
    })
    expect(dev.compact).toBe(false)
  })

  it('maybeUseBabel returns undefined (noop install path)', async () => {
    const tmp = createTempDir()
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8')
    const result = await babelMod.maybeUseBabel({} as any, tmp)
    expect(result).toBeUndefined()
  })
})
