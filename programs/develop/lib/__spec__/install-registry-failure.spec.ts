import {describe, expect, it} from 'vitest'
import {
  classifyInstallFailure,
  packageSpecFromTarballUrl
} from '../install-registry-failure'
import {CAPTURED_INSTALL_FAILURES} from './install-failure-captures'

const MANAGERS = ['npm', 'pnpm', 'pnpm10', 'yarn', 'bun', 'deno']

function captured(manager: string, scenario: string): string | undefined {
  return CAPTURED_INSTALL_FAILURES[`${manager}-${scenario}`]
}

function rows(scenario: string): Array<[string, string]> {
  return MANAGERS.flatMap((manager) => {
    const output = captured(manager, scenario)

    return output ? [[manager, output] as [string, string]] : []
  })
}

describe('classifyInstallFailure', () => {
  it('has a capture from npm, pnpm, yarn and bun for every scenario', () => {
    for (const scenario of [
      'tarball-404',
      'tarball-503',
      'tarball-reset',
      'version-transitive',
      'version-direct',
      'missing-package',
      'auth'
    ]) {
      for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) {
        expect(captured(manager, scenario), `${manager} ${scenario}`).toEqual(
          expect.any(String)
        )
      }
    }
  })

  it.each(
    rows('tarball-404')
  )('retries a listed tarball that answers 404 (%s) and names the version', (_manager, output) => {
    expect(classifyInstallFailure(output)).toEqual({
      kind: 'tarball-not-served',
      retry: true,
      packageSpec: 'stubx-dep@1.0.1'
    })
  })

  it.each(
    rows('tarball-503')
  )('retries a 503 from the registry (%s)', (_manager, output) => {
    expect(classifyInstallFailure(output)).toEqual({
      kind: 'registry-unavailable',
      retry: true,
      detail: 'HTTP 503'
    })
  })

  it.each(
    rows('tarball-reset')
  )('retries a connection the registry dropped (%s)', (_manager, output) => {
    expect(classifyInstallFailure(output)).toEqual({
      kind: 'registry-unavailable',
      retry: true,
      detail: 'connection reset'
    })
  })

  it.each(
    rows('version-transitive')
  )('retries a range an upstream package asked for (%s)', (_manager, output) => {
    expect(
      classifyInstallFailure(output, {directDependencies: ['stubx-parent']})
    ).toEqual({
      kind: 'version-not-listed',
      retry: true,
      packageSpec: 'stubx-late@^4.0.3'
    })
  })

  it.each(
    rows('version-direct')
  )('does not retry a range the project itself wrote (%s)', (_manager, output) => {
    expect(
      classifyInstallFailure(output, {directDependencies: ['stubx-late']})
    ).toEqual({
      kind: 'version-not-listed',
      retry: false,
      packageSpec: 'stubx-late@^9.0.0'
    })
  })

  it.each(
    rows('missing-package')
  )('does not retry a package the registry has never heard of (%s)', (_manager, output) => {
    expect(classifyInstallFailure(output)).toEqual({
      kind: 'permanent',
      retry: false
    })
  })

  it.each(
    rows('auth')
  )('does not retry a refused login (%s)', (_manager, output) => {
    expect(classifyInstallFailure(output)).toEqual({
      kind: 'permanent',
      retry: false
    })
  })

  it.each([
    [
      'a peer conflict',
      'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree'
    ],
    [
      'a full disk',
      'npm error code ENOSPC\nnpm error nospc ENOSPC: no space left on device, write'
    ],
    [
      'a folder it may not write',
      "npm error code EACCES\nnpm error syscall mkdir\nnpm error Error: EACCES: permission denied, mkdir '/project/node_modules'"
    ],
    [
      "deno's minimum dependency age",
      "error: Could not find npm package 'stubx-late' matching '^4.0.3'.\n\nA newer matching version was found, but it was not used because it was newer than the specified minimum dependency date."
    ],
    ['an error nothing here names', 'Segmentation fault'],
    ['no output at all', '']
  ])('does not retry %s', (_label, output) => {
    expect(classifyInstallFailure(output)).toEqual({
      kind: 'permanent',
      retry: false
    })
  })

  it('reads the tarball 404 the public registry answered during a release', () => {
    const output = [
      ' ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/postcss-custom-properties/-/postcss-custom-properties-15.0.5.tgz: Not Found - 404',
      '',
      'No authorization header was set for the request.'
    ].join('\n')

    expect(classifyInstallFailure(output)).toEqual({
      kind: 'tarball-not-served',
      retry: true,
      packageSpec: 'postcss-custom-properties@15.0.5'
    })
  })

  it('reads a timeout and a throttle as the registry being unavailable', () => {
    expect(
      classifyInstallFailure(
        'npm error code ETIMEDOUT\nnpm error network request to https://registry.npmjs.org/react failed, reason: connect ETIMEDOUT'
      )
    ).toMatchObject({kind: 'registry-unavailable', detail: 'timeout'})

    expect(
      classifyInstallFailure(
        'npm error code E429\nnpm error 429 Too Many Requests - GET https://registry.npmjs.org/react'
      )
    ).toMatchObject({kind: 'registry-unavailable', detail: 'HTTP 429'})
  })
})

describe('packageSpecFromTarballUrl', () => {
  it.each([
    ['https://registry.npmjs.org/react/-/react-19.2.0.tgz', 'react@19.2.0'],
    [
      'https://registry.npmjs.org/@csstools/css-tokenizer/-/css-tokenizer-4.0.3.tgz',
      '@csstools/css-tokenizer@4.0.3'
    ],
    [
      'https://registry.npmjs.org/@csstools%2fcss-tokenizer/-/css-tokenizer-4.0.3.tgz',
      '@csstools/css-tokenizer@4.0.3'
    ],
    [
      'https://example.test/npm/sass/-/sass-2.0.0-beta.1.tgz',
      'sass@2.0.0-beta.1'
    ],
    ['https://example.test/files/abc.tgz', 'https://example.test/files/abc.tgz']
  ])('%s', (url, spec) => {
    expect(packageSpecFromTarballUrl(url)).toBe(spec)
  })
})
