import * as fs from 'node:fs'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  buildPages,
  type PageBuildShape,
  writePageProject
} from './helpers/page-builds'

// What a page ships and what its entry imports, in every kind of build: a
// page with a script, a page with none, a sandbox page and a nested page.
// The reload and HMR additions belong to a development build alone.
const tempFolder = trackTempFolders()

const TIMEOUT = 180_000

const SHAPES: PageBuildShape[] = [
  'production build',
  'development build',
  'development session'
]

describe('the pages of a build and the entries behind them', () => {
  for (const shape of SHAPES) {
    it(
      `emits the same files, pages and page entries in a ${shape}`,
      async () => {
        const root = fs.realpathSync(tempFolder('extjs-page-builds-'))

        writePageProject(root)

        const build = await buildPages(root, shape)

        expect(build.errors).toEqual([])
        expect({
          files: build.files,
          html: build.html,
          entries: build.entries,
          pageLoaders: build.pageLoaders,
          ownAliases: build.ownAliases
        }).toMatchSnapshot()
      },
      TIMEOUT
    )
  }
})
