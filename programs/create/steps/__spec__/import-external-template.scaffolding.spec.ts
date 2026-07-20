import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  removeTemplateScaffoldingFiles,
  TEMPLATE_SCAFFOLDING_FILES
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
    fs.writeFileSync(
      path.join(project, 'template.meta.json'),
      '{"featured":true}'
    )
    fs.writeFileSync(path.join(project, 'template.spec.ts'), 'export {}')
    fs.writeFileSync(path.join(project, 'screenshot.png'), 'png')
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
