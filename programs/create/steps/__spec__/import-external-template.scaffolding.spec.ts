import {describe, it, expect, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  TEMPLATE_SCAFFOLDING_FILES,
  removeTemplateScaffoldingFiles
} from '../import-external-template'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-scaffold-'))
  tempDirs.push(dir)
  return dir
}

describe('removeTemplateScaffoldingFiles (issue #476)', () => {
  it('strips examples-repo scaffolding but keeps real project files', async () => {
    const project = makeProject()
    // Examples-internal files that must not ship.
    fs.writeFileSync(path.join(project, 'template.meta.json'), '{"featured":true}')
    fs.writeFileSync(path.join(project, 'template.spec.ts'), 'export {}')
    fs.writeFileSync(path.join(project, 'screenshot.png'), 'png')
    // Real project files that must survive.
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"x"}')
    fs.writeFileSync(path.join(project, 'tsconfig.json'), '{}')
    fs.mkdirSync(path.join(project, 'public'), {recursive: true})
    fs.writeFileSync(path.join(project, 'public', 'screenshot.png'), 'png')

    await removeTemplateScaffoldingFiles(project)

    for (const name of TEMPLATE_SCAFFOLDING_FILES) {
      expect(fs.existsSync(path.join(project, name))).toBe(false)
    }
    expect(fs.existsSync(path.join(project, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'tsconfig.json'))).toBe(true)
    // The README-embedded asset under public/ is untouched.
    expect(fs.existsSync(path.join(project, 'public', 'screenshot.png'))).toBe(
      true
    )
  })

  it('is a no-op when the scaffolding files are absent', async () => {
    const project = makeProject()
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"x"}')
    await expect(
      removeTemplateScaffoldingFiles(project)
    ).resolves.toBeUndefined()
    expect(fs.existsSync(path.join(project, 'package.json'))).toBe(true)
  })
})
