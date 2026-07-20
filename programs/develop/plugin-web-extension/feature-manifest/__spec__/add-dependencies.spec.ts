import {describe, expect, it} from 'vitest'
import {AddDependencies} from '../steps/add-dependencies'

describe('AddDependencies', () => {
  it('adds dependencies to compilation.fileDependencies if missing', () => {
    const added: string[] = []
    const deps = new Set<string>()
    const compilation: any = {
      errors: [],
      fileDependencies: deps
    }

    const compiler: any = {
      hooks: {
        afterCompile: {
          tap: (_name: string, fn: any) => fn(compilation)
        }
      }
    }

    // monkey-patch add to capture
    ;(deps as any).add = (x: string) => added.push(x)

    const plugin = new AddDependencies(['/a', '/b'])
    plugin.apply(compiler as any)

    expect(added).toEqual(['/a', '/b'])
  })

  it('registers dependencies even when the compilation errored (§66: an unwatched manifest can never clear the error)', () => {
    const added: string[] = []
    const deps = new Set<string>()
    const compilation: any = {
      errors: [new Error('boom')],
      fileDependencies: deps
    }

    const compiler: any = {
      hooks: {
        afterCompile: {
          tap: (_name: string, fn: any) => fn(compilation)
        }
      }
    }
    ;(deps as any).add = (x: string) => added.push(x)

    new AddDependencies(['/m/manifest.json']).apply(compiler as any)

    expect(added).toEqual(['/m/manifest.json'])
  })
})
