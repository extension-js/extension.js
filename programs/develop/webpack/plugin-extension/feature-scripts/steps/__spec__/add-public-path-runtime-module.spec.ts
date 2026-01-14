import {describe, it, expect} from 'vitest'
import {AddPublicPathRuntimeModule} from '../add-public-path-runtime-module'

function makeCompiler() {
  const runtimeTaps: any[] = []
  const addedModules: any[] = []

  const compiler: any = {
    webpack: {
      RuntimeGlobals: {publicPath: Symbol('publicPath')},
      Template: {},
      RuntimeModule: class {}
    },
    hooks: {
      compilation: {
        tap: (_name: string, cb: any) => {
          const compilation: any = {
            hooks: {
              runtimeRequirementInTree: {
                for: (_g: any) => ({
                  tap: (_n: string, fn: any) => {
                    runtimeTaps.push(fn)
                  }
                })
              }
            },
            addRuntimeModule: (chunk: any, mod: any) => {
              addedModules.push({chunk, mod})
            },
            outputOptions: {publicPath: '/'},
            getPath: (tpl: string) => tpl
          }
          cb(compilation)
        }
      }
    }
  }
  return {compiler, runtimeTaps, addedModules}
}

describe('AddPublicPathRuntimeModule', () => {
  it('registers runtime module for publicPath', () => {
    const {compiler, runtimeTaps, addedModules} = makeCompiler()
    new AddPublicPathRuntimeModule().apply(compiler as any)
    expect(runtimeTaps.length).toBe(1)
    runtimeTaps[0]({}) // simulate
    expect(addedModules.length).toBe(1)
  })
})

