import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {loadBrowserConfig} from '../config-loader'

describe('config-loader', () => {
  it('loadBrowserConfig returns defaults when no config present', async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-'))
    const cfg = await loadBrowserConfig(dir, 'chrome')
    expect(cfg.browser).toBe('chrome')
  })

  it('loads CommonJS extension.config.js with stable __dirname when project is ESM (type: module)', async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-'))

    // Simulate a project that is ESM by default
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({name: 'demo', type: 'module'}, null, 2),
      'utf-8'
    )

    // CommonJS config (intentionally) that relies on __dirname for path building
    fs.writeFileSync(
      path.join(dir, 'extension.config.js'),
      `
const path = require('path')
module.exports = {
  browser: {
    chrome: {
      profile: path.join(__dirname, 'dist', 'stable-profile')
    }
  }
}
`.trimStart(),
      'utf-8'
    )

    const cfg = await loadBrowserConfig(dir, 'chrome')
    expect(cfg.profile).toBe(path.join(dir, 'dist', 'stable-profile'))
  })

  it('falls back to workspace-root env files when project has none', async () => {
    const workspace = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-ws-'))
    const appDir = path.join(workspace, 'apps', 'demo-extension')
    fs.mkdirSync(appDir, {recursive: true})
    fs.writeFileSync(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n',
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, '.env'),
      'EXTENSION_PUBLIC_START_URL=https://workspace-root.example\n',
      'utf-8'
    )
    fs.writeFileSync(
      path.join(appDir, 'extension.config.mjs'),
      `
export default {
  browser: {
    chrome: {
      startingUrl: process.env.EXTENSION_PUBLIC_START_URL
    }
  }
}
`.trimStart(),
      'utf-8'
    )

    const previous = process.env.EXTENSION_PUBLIC_START_URL
    delete process.env.EXTENSION_PUBLIC_START_URL
    const cfg = await loadBrowserConfig(appDir, 'chrome')
    expect(cfg.startingUrl).toBe('https://workspace-root.example')
    if (previous === undefined) {
      delete process.env.EXTENSION_PUBLIC_START_URL
    } else {
      process.env.EXTENSION_PUBLIC_START_URL = previous
    }
  })
})
