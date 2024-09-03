import {Compiler, Compilation, sources} from '@rspack/core'

export class EagerlyLoadChunksPlugin {
  private readonly chunks: (string | number | null)[]

  constructor(chunks: (string | number | null)[]) {
    this.chunks = chunks
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'EagerlyLoadChunksPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'EagerlyLoadChunksPlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => {
            for (const chunk of compilation.chunks) {
              for (const group of chunk.groupsIterable) {
                const chunkIds = group.chunks.map((c) => c.id)
                const chunkLoadingCode = chunkIds
                  .filter((id) => this.chunks.includes(id || null))
                  .map((id) => `__webpack_require__.e(${JSON.stringify(id)})`)
                  .join(';')

                const runtimeSource = new sources.RawSource(chunkLoadingCode)

                if (chunk.files.has('main.js')) {
                  compilation.updateAsset(
                    'main.js',
                    (source) => new sources.ConcatSource(source, runtimeSource)
                  )
                }
              }
            }
          }
        )
      }
    )
  }

  generate() {
    return this.chunks
      .filter((x) => x !== null)
      .map((x) => `__webpack_require__.e(${JSON.stringify(x)})`)
      .join(';')
  }
}
