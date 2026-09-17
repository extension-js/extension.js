import {describe, expect, it} from 'vitest'
import {
  declaredCliDependency,
  installCommandFor,
  isComparableRange,
  versionMismatch
} from '../project-cli-version'

const scaffold = (range: string) => ({devDependencies: {extension: range}})

describe('the version the project asks for against the binary that answered', () => {
  it('says nothing when the running CLI satisfies the declared range', () => {
    expect(
      versionMismatch({manifest: scaffold('^4.1.22'), running: '4.1.22'})
    ).toBeNull()

    expect(
      versionMismatch({manifest: scaffold('^4.1.22'), running: '4.9.0'})
    ).toBeNull()
  })

  it('names both versions when a stale binary answers for the project', () => {
    expect(
      versionMismatch({manifest: scaffold('^4.1.22'), running: '2.0.0-rc.23'})
    ).toEqual({declared: 'extension', range: '^4.1.22', running: '2.0.0-rc.23'})
  })

  it('catches the other direction too, a newer major on an older project', () => {
    expect(
      versionMismatch({manifest: scaffold('^3.0.0'), running: '4.1.22'})
    ).toMatchObject({range: '^3.0.0', running: '4.1.22'})
  })

  it('reads extension-develop when that is what the project declares', () => {
    expect(
      declaredCliDependency({dependencies: {'extension-develop': '^4.0.0'}})
    ).toEqual({name: 'extension-develop', range: '^4.0.0'})
  })

  it('stays quiet for a project that declares no CLI at all', () => {
    expect(versionMismatch({manifest: {}, running: '4.1.22'})).toBeNull()
    expect(versionMismatch({manifest: null, running: '4.1.22'})).toBeNull()
  })

  it('stays quiet for a range that names a checkout, not a version', () => {
    for (const range of [
      'workspace:*',
      'file:../extension',
      'link:../extension',
      '../extension',
      'github:extension-js/extension.js',
      '*',
      'latest'
    ]) {
      expect(isComparableRange(range)).toBe(false)
      expect(
        versionMismatch({manifest: scaffold(range), running: '4.1.22'})
      ).toBeNull()
    }
  })

  it('stays quiet when the running version is not a version', () => {
    expect(
      versionMismatch({manifest: scaffold('^4.1.22'), running: 'unknown'})
    ).toBeNull()
  })

  it('names the install command the project lockfile implies', () => {
    expect(installCommandFor(['package.json'])).toBe('npm install')
    expect(installCommandFor(['pnpm-lock.yaml'])).toBe('pnpm install')
    expect(installCommandFor(['yarn.lock'])).toBe('yarn install')
    expect(installCommandFor(['bun.lock'])).toBe('bun install')
    expect(installCommandFor(['deno.lock'])).toBe('deno install')
  })
})
