import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {devConfigHookContext, resolveDevProjectRoot} from '../index'

const p = (...parts: string[]) => path.resolve('/proj', ...parts)

describe('the project root a dev session reads its config from', () => {
  it.each([
    [
      'the package root when the manifest is in src',
      {
        manifestPath: p('src', 'manifest.json'),
        packageJsonPath: p('package.json')
      },
      p()
    ],
    [
      'the deno.json folder for a Deno project',
      {manifestPath: p('src', 'manifest.json'), denoJsonPath: p('deno.json')},
      p()
    ],
    [
      'the manifest folder when there is no project manifest',
      {manifestPath: p('ext', 'manifest.json')},
      p('ext')
    ],
    [
      'the named folder when the manifest sits below it with no project manifest',
      {manifestPath: p('src', 'manifest.json'), projectRoot: p()},
      p()
    ]
  ])('is %s', (_name, structure, expected) => {
    expect(resolveDevProjectRoot(structure)).toBe(expected)
  })

  it('tells the config hooks the browser, the dev mode and command, and rspack', () => {
    expect(devConfigHookContext('chrome')).toEqual({
      browser: 'chrome',
      mode: 'development',
      command: 'dev',
      rspack
    })
  })
})
