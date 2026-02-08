export default function createEagerlyLoadChunksRuntimeModule(
  webpack: typeof import('webpack')
) {
  const {RuntimeGlobals, RuntimeModule, Template} = webpack as any
  return class EagerlyLoadChunksRuntimeModule extends RuntimeModule {
    private readonly chunkIds: Array<string | number>
    constructor(chunkIds: Array<string | number>) {
      super('eagerly load chunks', RuntimeModule.STAGE_NORMAL)
      this.chunkIds = chunkIds
    }
    generate() {
      const {compilation} = this as any
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] EagerlyLoadChunksRuntimeModule skipped because no compilation is found. */'
        )
      const _const = compilation.outputOptions.environment.const
        ? 'const'
        : 'var'
      return Template.asString([
        `${_const} __extjsChunkIds = ${JSON.stringify(this.chunkIds)};`,
        `${_const} __extjsLoad = ${RuntimeGlobals.ensureChunkHandlers};`,
        `for (${_const} __extjsId of __extjsChunkIds) __extjsLoad(__extjsId);`
      ])
    }
  }
}
