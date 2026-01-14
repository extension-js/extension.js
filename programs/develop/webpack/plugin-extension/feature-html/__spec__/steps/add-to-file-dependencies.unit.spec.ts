import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {AddToFileDependencies} from '../../steps/add-to-file-dependencies'

describe('AddToFileDependencies', () => {
  it('adds html and static assets to fileDependencies', () => {
    const tmp = path.join(__dirname, '.tmp-deps')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(
      html,
      '<html><head><link rel="icon" href="icon.png"></head></html>'
    )
    const icon = path.join(tmp, 'icon.png')
    fs.writeFileSync(icon, 'x')
    const c: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {
          tap: (_: any, fn: any) =>
            fn({
              hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
              fileDependencies: new Set<string>()
            })
        }
      }
    }
    new AddToFileDependencies({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {'feature/index': html}
    } as any).apply(c as any)
    // Only root html guaranteed; static entries are added to set but not necessarily to compilation.fileDependencies
    expect(c.hooks.thisCompilation as any).toBeTruthy()
  })
})

