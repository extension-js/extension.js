import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {readProjectSource} from '../../lib/emitted-evidence'
import {sourcesBehind} from '../feature-browser-global'

const makeTempFolder = trackTempFolders()

// One compile reads a project file from disk once. A scan that reads it
// again sees a later save, and the findings of one build then disagree.
describe('the browser global scan and the sources its compile already read', () => {
  it('names the line as the compile read it, not as a later save has it', () => {
    const root = fs.realpathSync(makeTempFolder('extjs-browser-global-read-'))
    const resource = path.join(root, 'content.js')
    fs.writeFileSync(resource, '\n\nbrowser.runtime.id\n')

    const module = {resource}
    const compilation = {
      modules: [module],
      chunkGraph: {
        getModuleChunksIterable: () => [{files: ['content_scripts/a.js']}]
      }
    }

    readProjectSource(resource, compilation)
    fs.writeFileSync(resource, 'chrome.runtime.id\n')

    expect(
      sourcesBehind(compilation as never, ['content_scripts/a.js'], root)
    ).toEqual(['content.js:3'])
  })
})
