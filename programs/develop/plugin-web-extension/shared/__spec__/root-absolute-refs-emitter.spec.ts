import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  idleCompiler,
  writeProject
} from '../../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {HtmlPlugin} from '../../feature-html'
import {emitRootAbsoluteRefs} from '../../feature-html/steps/emit-root-absolute-refs'
import {rootAbsoluteRefsEmitterFor} from '../root-absolute-refs-emitter'

const makeTempFolder = trackTempFolders()

function project() {
  const root = writeProject(makeTempFolder('extjs-root-refs-emitter-'), {
    'manifest.json': {manifest_version: 3, name: 'emitter', version: '1.0.0'}
  })

  return {root, compiler: idleCompiler(root, 'production')}
}

describe('the emitter of root absolute refs', () => {
  it('is the one the HTML feature hands in for its own compiler', () => {
    const {root, compiler} = project()

    expect(rootAbsoluteRefsEmitterFor(compiler)).toBeUndefined()

    new HtmlPlugin({
      manifestPath: path.join(root, 'manifest.json'),
      browser: 'chrome'
    }).apply(compiler)

    expect(rootAbsoluteRefsEmitterFor(compiler)).toBe(emitRootAbsoluteRefs)
  })

  it('is none for a compiler the HTML feature never saw', () => {
    const first = project()
    const second = project()

    new HtmlPlugin({
      manifestPath: path.join(first.root, 'manifest.json'),
      browser: 'chrome'
    }).apply(first.compiler)

    expect(rootAbsoluteRefsEmitterFor(second.compiler)).toBeUndefined()
  })
})
