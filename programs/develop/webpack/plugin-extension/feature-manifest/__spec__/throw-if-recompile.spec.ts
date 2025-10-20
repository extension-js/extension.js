import {describe, it, expect} from 'vitest'
import {ThrowIfRecompileIsNeeded} from '../steps/throw-if-recompile'

describe('ThrowIfRecompileIsNeeded', () => {
  it('registers watchRun hook without throwing', () => {
    let registered = false

    const compiler: any = {
      modifiedFiles: new Set<string>(),
      options: {context: '/root'},
      hooks: {
        watchRun: {
          tapAsync: () => {
            registered = true
          }
        },
        thisCompilation: {
          tap: () => {}
        }
      }
    }

    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler)

    expect(registered).toBe(true)
  })
})
