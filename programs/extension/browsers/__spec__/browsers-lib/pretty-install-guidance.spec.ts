import fs from 'node:fs'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {prettyPuppeteerInstallGuidance} from '../../browsers-lib/messages'

const makeTempFolder = trackTempFolders()

describe('prettyPuppeteerInstallGuidance', () => {
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    vi.unstubAllEnvs()
  })

  it('prefers the active package manager command and preserves colored output', () => {
    const root = makeTempFolder('ext-guidance-')
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
    vi.stubEnv('npm_config_user_agent', 'pnpm/10.28.0 npm/? node/v23.8.0')

    const msg = prettyPuppeteerInstallGuidance(
      'chrome' as any,
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
    const root = makeTempFolder('ext-guidance-')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    vi.stubEnv('npm_config_user_agent', undefined)

    const msg = prettyPuppeteerInstallGuidance(
      'chromium' as any,
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
    const root = makeTempFolder('ext-guidance-')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    vi.stubEnv('npm_config_user_agent', undefined)

    const msg = prettyPuppeteerInstallGuidance(
      'edge' as any,
      'C:\\Users\\cosmo\\AppData\\Local\\extension.js\\browsers',
      'win32'
    )

    expect(msg.split('\n').slice(0, 7)).toEqual([
      "⏵⏵⏵ Edge isn't installed.",
      '',
      'Install Edge system-wide (the installer may ask for an administrator password):',
      '',
      '  npx extension install edge',
      '',
      'Or use an Edge already installed. Looked at:'
    ])

    expect(msg).not.toContain('managed browser cache')
    expect(msg).not.toContain('PATH')
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
    const root = makeTempFolder('ext-guidance-')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    vi.stubEnv('npm_config_user_agent', undefined)

    const msg = prettyPuppeteerInstallGuidance(
      'edge' as any,
      '/tmp/extension.js/browsers',
      'darwin'
    )

    expect(msg.split('\n')).toEqual([
      "⏵⏵⏵ Edge isn't installed.",
      '',
      'Install Edge system-wide (the installer may ask for an administrator password):',
      '',
      '  npx extension install edge',
      'Run your command again after the install finishes.',
      ''
    ])
  })

  it('does not add the Chrome alternative for non-chromium targets', () => {
    const root = makeTempFolder('ext-guidance-')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}))

    process.chdir(root)
    vi.stubEnv('npm_config_user_agent', undefined)

    const msg = prettyPuppeteerInstallGuidance(
      'firefox' as any,
      '/tmp/extension.js/browsers'
    )

    expect(msg).toContain('npx extension install firefox')
    expect(msg).not.toContain('Or install Chrome for Testing')
  })
})
