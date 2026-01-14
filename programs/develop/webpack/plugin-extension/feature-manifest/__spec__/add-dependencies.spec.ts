import {describe, it, expect} from 'vitest'
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
})

