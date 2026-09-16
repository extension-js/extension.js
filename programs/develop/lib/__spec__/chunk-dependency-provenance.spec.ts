import {describe, expect, it} from 'vitest'
import {
  collectChunkDependencyProvenance,
  packageNameFromPath
} from '../chunk-dependency-provenance'

function compilation(
  chunks: Array<{files: string[]; modules: Array<string | object>}>
) {
  return {
    chunks,
    chunkGraph: {
      getChunkModulesIterable: (chunk: unknown) =>
        (chunk as {modules: Array<string | object>}).modules.map((entry) =>
          typeof entry === 'string' ? {resource: entry} : entry
        )
    }
  }
}

describe('packageNameFromPath', () => {
  it('names a flat package', () => {
    expect(packageNameFromPath('/app/node_modules/react-dom/index.js')).toBe(
      'react-dom'
    )
  })

  it('keeps both segments of a scoped package', () => {
    expect(packageNameFromPath('/app/node_modules/@vue/runtime/index.js')).toBe(
      '@vue/runtime'
    )
  })

  it('takes the innermost package when they nest', () => {
    expect(
      packageNameFromPath('/app/node_modules/a/node_modules/b/index.js')
    ).toBe('b')
  })

  it('looks past a pnpm version directory', () => {
    expect(
      packageNameFromPath(
        '/app/node_modules/.pnpm/react-dom@19.0.0/node_modules/react-dom/cjs/x.js'
      )
    ).toBe('react-dom')
  })

  it('returns null for the project own source', () => {
    expect(packageNameFromPath('/app/src/content/index.ts')).toBeNull()
  })

  it('handles windows separators', () => {
    expect(packageNameFromPath('C:\\app\\node_modules\\react\\index.js')).toBe(
      'react'
    )
  })
})

describe('collectChunkDependencyProvenance', () => {
  it('marks a chunk with nothing but dependencies', () => {
    const map = collectChunkDependencyProvenance(
      compilation([
        {
          files: ['shared/framework.js'],
          modules: [
            '/app/node_modules/react/index.js',
            '/app/node_modules/react-dom/client.js'
          ]
        }
      ])
    )

    expect(map.get('shared/framework.js')).toEqual({
      packages: ['react', 'react-dom'],
      onlyDependencies: true
    })
  })

  it('marks a chunk that mixes the developer source in', () => {
    const map = collectChunkDependencyProvenance(
      compilation([
        {
          files: ['content_scripts/content-0.js'],
          modules: [
            '/app/src/content/index.ts',
            '/app/node_modules/react-dom/client.js'
          ]
        }
      ])
    )

    expect(map.get('content_scripts/content-0.js')).toEqual({
      packages: ['react-dom'],
      onlyDependencies: false
    })
  })

  it('leaves a chunk of purely developer code unlisted', () => {
    const map = collectChunkDependencyProvenance(
      compilation([
        {files: ['background/scripts.js'], modules: ['/app/src/background.ts']}
      ])
    )

    expect(map.has('background/scripts.js')).toBe(false)
  })

  it('does not let a synthetic runtime module make a vendor chunk look mixed', () => {
    const map = collectChunkDependencyProvenance(
      compilation([
        {
          files: ['shared/framework.js'],
          modules: [
            {identifier: () => 'webpack/runtime/make namespace object'},
            '/app/node_modules/react/index.js'
          ]
        }
      ])
    )

    expect(map.get('shared/framework.js')?.onlyDependencies).toBe(true)
  })

  it('falls back to the module identifier when there is no resource', () => {
    const map = collectChunkDependencyProvenance(
      compilation([
        {
          files: ['shared/framework.js'],
          modules: [{identifier: () => '/app/node_modules/preact/index.js'}]
        }
      ])
    )

    expect(map.get('shared/framework.js')?.packages).toEqual(['preact'])
  })

  it('skips non-script files a chunk also emits', () => {
    const map = collectChunkDependencyProvenance(
      compilation([
        {
          files: ['sidebar/index.js', 'sidebar/index.css'],
          modules: ['/app/node_modules/react/index.js']
        }
      ])
    )

    expect(map.has('sidebar/index.js')).toBe(true)
    expect(map.has('sidebar/index.css')).toBe(false)
  })

  it('returns an empty map when the compilation exposes no chunk graph', () => {
    expect(collectChunkDependencyProvenance(null).size).toBe(0)
    expect(collectChunkDependencyProvenance({chunks: []}).size).toBe(0)
  })
})
