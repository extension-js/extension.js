// @ts-check
/**
 * @param {import('webpack')} webpack
 */
module.exports = function createEagerlyLoadChunksRuntimeModule(webpack) {
  const { RuntimeGlobals, RuntimeModule, Template } = webpack
  class EagerlyLoadChunksRuntimeModule extends RuntimeModule {
    /**
     * @param {(string | number | null)[]} chunks
     */
    constructor(chunks) {
      super('eagerly load chunks', RuntimeModule.STAGE_TRIGGER)
      this.chunks = chunks
    }
    generate() {
      return Template.asString(
        this.chunks
          .filter((x) => x !== null)
          .map((x) => `${RuntimeGlobals.ensureChunkHandlers}.i(${JSON.stringify(x)});`),
      )
    }
  }
  return EagerlyLoadChunksRuntimeModule
}
