import {describe, expect, it} from 'vitest'
import {
  asCompilation,
  asCompiler,
  type TapCallback
} from '../../__spec__/helpers/rspack-fakes'
import {AddDependencies} from '../steps/add-dependencies'

describe('AddDependencies', () => {
  it('adds dependencies to compilation.fileDependencies if missing', () => {
    const added: string[] = []
    const deps = new Set<string>()
    const compilation = asCompilation({
      errors: [],
      fileDependencies: deps
    })

    const compiler = asCompiler({
      hooks: {
        afterCompile: {
          tap: (_name: string, fn: TapCallback) => fn(compilation)
        }
      }
    })

    deps.add = (x: string) => {
      added.push(x)

      return deps
    }

    const plugin = new AddDependencies(['/a', '/b'])
    plugin.apply(compiler)

    expect(added).toEqual(['/a', '/b'])
  })

  it('registers dependencies even when the compilation errored: an unwatched manifest can never clear the error', () => {
    const added: string[] = []
    const deps = new Set<string>()
    const compilation = asCompilation({
      errors: [new Error('boom')],
      fileDependencies: deps
    })

    const compiler = asCompiler({
      hooks: {
        afterCompile: {
          tap: (_name: string, fn: TapCallback) => fn(compilation)
        }
      }
    })

    deps.add = (x: string) => {
      added.push(x)

      return deps
    }

    new AddDependencies(['/m/manifest.json']).apply(compiler)

    expect(added).toEqual(['/m/manifest.json'])
  })
})
