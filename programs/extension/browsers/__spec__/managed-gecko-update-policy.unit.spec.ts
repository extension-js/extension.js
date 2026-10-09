import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  applyManagedFirefoxInstallPolicy,
  ensureManagedGeckoUpdatePolicy,
  geckoPolicyFilePath,
  isInsideManagedCache,
  MANAGED_GECKO_POLICIES
} from '../run-firefox/firefox-launch/managed-update-policy'

describe('managed Gecko update policy location', () => {
  it('puts the macOS policy in the app bundle Resources/distribution', () => {
    expect(
      geckoPolicyFilePath(
        '/Users/me/Library/Caches/extension.js/browsers/firefox/firefox/mac_arm-nightly_158.0a1/Firefox Nightly.app/Contents/MacOS/firefox',
        'darwin'
      )
    ).toBe(
      '/Users/me/Library/Caches/extension.js/browsers/firefox/firefox/mac_arm-nightly_158.0a1/Firefox Nightly.app/Contents/Resources/distribution/policies.json'
    )
  })

  it('returns null on macOS when the binary sits outside an app bundle', () => {
    expect(geckoPolicyFilePath('/opt/firefox/firefox', 'darwin')).toBeNull()
  })

  it('puts the Linux policy beside the firefox binary', () => {
    expect(
      geckoPolicyFilePath(
        '/home/me/.cache/extension.js/browsers/firefox/firefox/linux-stable_140.0/firefox/firefox',
        'linux'
      )
    ).toBe(
      '/home/me/.cache/extension.js/browsers/firefox/firefox/linux-stable_140.0/firefox/distribution/policies.json'
    )
  })

  it('puts the Windows policy beside firefox.exe', () => {
    expect(
      geckoPolicyFilePath(
        'C:\\Users\\me\\AppData\\Local\\extension.js\\browsers\\firefox\\firefox\\win64-stable_140.0\\core\\firefox.exe',
        'win32'
      )
    ).toBe(
      'C:\\Users\\me\\AppData\\Local\\extension.js\\browsers\\firefox\\firefox\\win64-stable_140.0\\core\\distribution\\policies.json'
    )
  })

  it('pins the policy content to DisableAppUpdate', () => {
    expect(MANAGED_GECKO_POLICIES).toEqual({DisableAppUpdate: true})
  })

  it('counts only binaries under a managed root', () => {
    const roots = ['/cache/extension.js/browsers']

    expect(
      isInsideManagedCache(
        '/cache/extension.js/browsers/firefox/x/firefox',
        roots,
        'linux'
      )
    ).toBe(true)

    expect(isInsideManagedCache('/usr/bin/firefox', roots, 'linux')).toBe(false)
    expect(
      isInsideManagedCache(
        '/cache/extension.js/browsers-other/firefox',
        roots,
        'linux'
      )
    ).toBe(false)

    expect(isInsideManagedCache('/usr/bin/firefox', [''], 'linux')).toBe(false)
  })
})

describe('managed Gecko update policy writes', () => {
  let tmp: string
  let cacheRoot: string

  function fakeManagedBinary(root: string): string {
    const versionDir = path.join(root, 'firefox', 'firefox')

    if (process.platform === 'darwin') {
      return path.join(
        versionDir,
        'mac_arm-nightly_158.0a1',
        'Firefox Nightly.app',
        'Contents',
        'MacOS',
        'firefox'
      )
    }

    if (process.platform === 'win32') {
      return path.join(versionDir, 'win64-stable_140.0', 'core', 'firefox.exe')
    }

    return path.join(versionDir, 'linux-stable_140.0', 'firefox', 'firefox')
  }

  function createBinary(binaryPath: string) {
    fs.mkdirSync(path.dirname(binaryPath), {recursive: true})
    fs.writeFileSync(binaryPath, '#!/bin/sh\n')
    fs.chmodSync(binaryPath, 0o755)
  }

  function readPolicy(binaryPath: string) {
    const policyPath = geckoPolicyFilePath(binaryPath) as string

    return JSON.parse(fs.readFileSync(policyPath, 'utf8'))
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-gecko-policy-'))
    cacheRoot = path.join(tmp, 'browsers')
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('writes the policy into a managed install', () => {
    const binaryPath = fakeManagedBinary(cacheRoot)
    createBinary(binaryPath)

    const result = ensureManagedGeckoUpdatePolicy({
      binaryPath,
      managedRoots: [cacheRoot]
    })

    expect(result).toEqual({
      status: 'written',
      policyPath: geckoPolicyFilePath(binaryPath)
    })

    expect(readPolicy(binaryPath)).toEqual({
      policies: {DisableAppUpdate: true}
    })
  })

  it('leaves a policy that is already in place untouched', () => {
    const binaryPath = fakeManagedBinary(cacheRoot)
    createBinary(binaryPath)
    ensureManagedGeckoUpdatePolicy({binaryPath, managedRoots: [cacheRoot]})
    const policyPath = geckoPolicyFilePath(binaryPath) as string
    const before = fs.statSync(policyPath).mtimeMs

    const result = ensureManagedGeckoUpdatePolicy({
      binaryPath,
      managedRoots: [cacheRoot]
    })

    expect(result.status).toBe('present')
    expect(fs.statSync(policyPath).mtimeMs).toBe(before)
  })

  it('keeps other policies when it adds DisableAppUpdate', () => {
    const binaryPath = fakeManagedBinary(cacheRoot)
    createBinary(binaryPath)
    const policyPath = geckoPolicyFilePath(binaryPath) as string
    fs.mkdirSync(path.dirname(policyPath), {recursive: true})
    fs.writeFileSync(
      policyPath,
      JSON.stringify({policies: {DisableTelemetry: true}})
    )

    ensureManagedGeckoUpdatePolicy({binaryPath, managedRoots: [cacheRoot]})

    expect(readPolicy(binaryPath)).toEqual({
      policies: {DisableTelemetry: true, DisableAppUpdate: true}
    })
  })

  it('replaces a malformed policy file', () => {
    const binaryPath = fakeManagedBinary(cacheRoot)
    createBinary(binaryPath)
    const policyPath = geckoPolicyFilePath(binaryPath) as string
    fs.mkdirSync(path.dirname(policyPath), {recursive: true})
    fs.writeFileSync(policyPath, '{not json')

    ensureManagedGeckoUpdatePolicy({binaryPath, managedRoots: [cacheRoot]})

    expect(readPolicy(binaryPath)).toEqual({
      policies: {DisableAppUpdate: true}
    })
  })

  it('never writes into a binary outside the managed cache', () => {
    const binaryPath = fakeManagedBinary(path.join(tmp, 'system'))
    createBinary(binaryPath)

    const result = ensureManagedGeckoUpdatePolicy({
      binaryPath,
      managedRoots: [cacheRoot]
    })

    expect(result).toEqual({
      status: 'skipped',
      reason: 'outside-managed-cache'
    })

    expect(fs.existsSync(geckoPolicyFilePath(binaryPath) as string)).toBe(false)
  })

  it('reports a write failure without throwing', () => {
    const binaryPath = fakeManagedBinary(cacheRoot)
    const failingFs = {
      existsSync: () => false,
      readFileSync: fs.readFileSync,
      mkdirSync: () => {
        throw new Error('read-only file system')
      },
      writeFileSync: fs.writeFileSync,
      renameSync: fs.renameSync
    } as unknown as Parameters<typeof ensureManagedGeckoUpdatePolicy>[0]['fs']

    const result = ensureManagedGeckoUpdatePolicy({
      binaryPath,
      managedRoots: [cacheRoot],
      fs: failingFs
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: 'read-only file system'
    })
  })

  it('applies the policy to a fresh managed Firefox install', () => {
    const binaryPath = fakeManagedBinary(cacheRoot)
    createBinary(binaryPath)

    const result = applyManagedFirefoxInstallPolicy(
      path.join(cacheRoot, 'firefox'),
      cacheRoot
    )

    expect(result.status).toBe('written')
    expect(readPolicy(binaryPath)).toEqual({
      policies: {DisableAppUpdate: true}
    })
  })
})
