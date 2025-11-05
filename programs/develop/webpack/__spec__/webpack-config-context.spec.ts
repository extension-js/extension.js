import * as path from 'path'
import {describe, it, expect} from 'vitest'
import webpackConfig from '../webpack-config'

describe('webpack-config context', () => {
  it('uses packageJsonDir as context when provided', () => {
    const manifestPath = '/repo/packages/feature/manifest.json'
    const packageJsonPath = '/repo/packages/package.json'
    const cfg = webpackConfig({manifestPath, packageJsonPath}, {
      mode: 'development',
      browser: 'chrome',
      output: {clean: false, path: 'dist/chrome'}
    } as any)

    expect(cfg.context).toBe(path.dirname(packageJsonPath))
  })

  it('falls back to manifestDir as context in web-only mode', () => {
    const manifestPath = '/repo/feature/manifest.json'
    const cfg = webpackConfig({manifestPath}, {
      mode: 'development',
      browser: 'chrome',
      output: {clean: false, path: 'dist/chrome'}
    } as any)

    expect(cfg.context).toBe(path.dirname(manifestPath))
  })
})
