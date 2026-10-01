import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {explicitUnpackedDir} from '../command-preview'

const created: string[] = []

function tree(layout: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preview-unpacked-'))
  )
  created.push(root)

  for (const [rel, content] of Object.entries(layout)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('explicitUnpackedDir', () => {
  it('treats a manifest folder under an ancestor project as the extension', () => {
    const root = tree({
      'package.json': '{"name":"repo"}',
      'build/firefox/manifest.json': '{}'
    })
    const typed = path.join(root, 'build', 'firefox')

    expect(explicitUnpackedDir(typed, root)).toBe(typed)
  })

  it('leaves a project root, a src/ folder and a remote url to the normal path', () => {
    const root = tree({
      'package.json': '{"name":"app"}',
      'manifest.json': '{}',
      'src/manifest.json': '{}'
    })

    expect(explicitUnpackedDir(root, root)).toBeUndefined()
    expect(explicitUnpackedDir(path.join(root, 'src'), root)).toBeUndefined()
    expect(
      explicitUnpackedDir('https://example.com/ext.zip', root)
    ).toBeUndefined()

    expect(explicitUnpackedDir(undefined, root)).toBeUndefined()
  })

  it('answers nothing for a folder without a manifest', () => {
    const root = tree({'package.json': '{"name":"repo"}', 'build/x.js': ''})

    expect(explicitUnpackedDir(path.join(root, 'build'), root)).toBeUndefined()
  })
})
