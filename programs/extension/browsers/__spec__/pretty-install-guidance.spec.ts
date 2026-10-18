import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {prettyPuppeteerInstallGuidance} from '../browsers-lib/messages'

describe('prettyPuppeteerInstallGuidance', () => {
  const prevCwd = process.cwd()
  const prevEnv = {...process.env}

  afterEach(() => {
    process.chdir(prevCwd)
    process.env = {...prevEnv}
  })

  it('prefers the active package manager command and preserves colored output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-guidance-'))
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            extension: 'extension'
          }
        },
        null,
        2
      )
    )

    process.chdir(root)
    process.env.npm_config_user_agent = 'pnpm/10.28.0 npm/? node/v23.8.0'

    const msg = prettyPuppeteerInstallGuidance(
      'chrome' as any,
      'npx extension install chrome',
      '/tmp/extension.js/browsers'
    )

    expect(msg).toContain('pnpm extension install chrome')
    expect(msg).toContain(
      "Chrome for Testing isn't available in the managed browser cache."
    )

    expect(msg).toContain(
      'Install Chrome for Testing into the managed browser cache:'
    )

    expect(msg).toContain('  pnpm extension install chrome')
    expect(msg).toContain("Chrome for Testing isn't available")
    expect(msg).toContain('PATH')
    expect(msg).toContain('Run your command again after the install finishes.')
  })

  it('recommends Chrome for Testing as the stable alternative for chromium', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-guidance-'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    delete process.env.npm_config_user_agent

    const msg = prettyPuppeteerInstallGuidance(
      'chromium' as any,
      'raw guidance (unused)',
      '/tmp/extension.js/browsers'
    )

    expect(msg).toContain("Chromium isn't available")
    expect(msg).toContain('npx extension install chromium')
    expect(msg).toContain(
      'Or install Chrome for Testing (stable channel), chromium targets use it automatically:'
    )

    expect(msg).toContain('npx extension install chrome')
  })

  it('names the system Edge locations and the overrides on Windows', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-guidance-'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    delete process.env.npm_config_user_agent

    const msg = prettyPuppeteerInstallGuidance(
      'edge' as any,
      'raw guidance (unused)',
      'C:\\Users\\cosmo\\AppData\\Local\\extension.js\\browsers',
      'win32'
    )

    expect(msg).toContain("Edge isn't available")
    expect(msg).toContain(
      '%LOCALAPPDATA%\\Microsoft\\Edge\\Application\\msedge.exe'
    )

    expect(msg).toContain(
      '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'
    )

    expect(msg).toContain(
      '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe'
    )

    expect(msg).toContain('EDGE_BINARY')
    expect(msg).toContain('--chromium-binary')
  })

  it('keeps the Windows Edge note off other platforms', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-guidance-'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    delete process.env.npm_config_user_agent

    const msg = prettyPuppeteerInstallGuidance(
      'edge' as any,
      'raw guidance (unused)',
      '/tmp/extension.js/browsers',
      'darwin'
    )

    expect(msg).not.toContain('%ProgramFiles%')
    expect(msg).not.toContain('EDGE_BINARY')
  })

  it('does not add the Chrome alternative for non-chromium targets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-guidance-'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    delete process.env.npm_config_user_agent

    const msg = prettyPuppeteerInstallGuidance(
      'firefox' as any,
      'raw guidance (unused)',
      '/tmp/extension.js/browsers'
    )

    expect(msg).toContain('npx extension install firefox')
    expect(msg).not.toContain('Or install Chrome for Testing')
  })
})
