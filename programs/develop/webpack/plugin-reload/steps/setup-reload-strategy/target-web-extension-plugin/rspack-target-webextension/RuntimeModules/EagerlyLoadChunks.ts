import {type rspack} from '@rspack/core'

export function createEagerlyLoadChunksRuntimeModule(webpack: typeof rspack) {
  const {RuntimeGlobals, RuntimeModule, Template} = webpack

  class EagerlyLoadChunksRuntimeModule extends RuntimeModule {
    constructor(chunks: (string | number | null)[]) {
      super('eagerly load chunks', RuntimeModule.STAGE_TRIGGER)
      this.chunks = chunks
    }

    generate() {
      return Template.asString(
        this.chunks
          .filter((x) => x !== null)
          .map(
            (x) =>
              `${RuntimeGlobals.ensureChunkHandlers}.i(${JSON.stringify(x)})`
          )
      )
    }
  }

  return EagerlyLoadChunksRuntimeModule
}
