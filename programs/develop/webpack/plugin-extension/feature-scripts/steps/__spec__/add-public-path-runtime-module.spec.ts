import {describe, it, expect} from 'vitest'
import {AddPublicPathRuntimeModule} from '../add-public-path-runtime-module'

function makeCompiler() {
  const runtimeTaps: any[] = []
  const addedModules: any[] = []

  const compiler: any = {
    webpack: {
      RuntimeGlobals: {publicPath: '__webpack_require__.p'},
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

  it('does not emit a throwing runtime getter', () => {
    const {compiler, runtimeTaps, addedModules} = makeCompiler()
    // Minimal Template.asString stub to capture generated code
    ;(compiler.webpack.Template as any).asString = (lines: string[]) =>
      lines.filter(Boolean).join('\n')
    ;(compiler.webpack.Template as any).indent = (l: any) => String(l)
    ;(compiler.webpack.RuntimeModule as any) = class {
      public compilation: any
      constructor() {}
    }

    new AddPublicPathRuntimeModule().apply(compiler as any)
    runtimeTaps[0]({}) // add module
    const mod = addedModules[0].mod
    mod.compilation = {
      outputOptions: {publicPath: '/'},
      getPath: (tpl: string) => tpl,
      hash: 'XXXX'
    }
    const code = mod.generate()
    expect(String(code)).not.toContain('throw new Error("No chrome or browser runtime found")')
  })
})
