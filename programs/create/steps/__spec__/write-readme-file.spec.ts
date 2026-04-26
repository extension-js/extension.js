import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect} from 'vitest'
import {writeReadmeFile} from '../write-readme-file'

async function withTempProject(
  setup: (projectPath: string) => Promise<void>,
  body: (projectPath: string) => Promise<void>
) {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ext-create-readme-'))
  const projectPath = path.join(tmpRoot, 'my-ext')
  try {
    await fsp.mkdir(projectPath, {recursive: true})
    await setup(projectPath)
    await body(projectPath)
  } finally {
    await fsp.rm(tmpRoot, {recursive: true, force: true})
  }
}

const noopLogger = {log() {}, error() {}}

describe('writeReadmeFile', () => {
  it('overwrites an existing README so the project reads as the user’s own', async () => {
    await withTempProject(
      async (projectPath) => {
        await fsp.writeFile(
          path.join(projectPath, 'manifest.json'),
          JSON.stringify({manifest_version: 3, description: 'My Description'})
        )
        await fsp.writeFile(
          path.join(projectPath, 'README.md'),
          '# Upstream Template\n\nMarketing copy from the template repo.\n'
        )
      },
      async (projectPath) => {
        await writeReadmeFile(projectPath, 'my-ext', noopLogger)
        const contents = await fsp.readFile(
          path.join(projectPath, 'README.md'),
          'utf8'
        )
        expect(contents).toContain('# my-ext')
        expect(contents).toContain('> My Description')
        expect(contents).not.toContain('Upstream Template')
        expect(contents).not.toContain('Marketing copy')
      }
    )
  })

  it('embeds public/screenshot.png when present and skips the embed otherwise', async () => {
    await withTempProject(
      async (projectPath) => {
        await fsp.writeFile(
          path.join(projectPath, 'manifest.json'),
          JSON.stringify({manifest_version: 3, description: 'with screenshot'})
        )
        await fsp.mkdir(path.join(projectPath, 'public'), {recursive: true})
        await fsp.writeFile(
          path.join(projectPath, 'public', 'screenshot.png'),
          ''
        )
      },
      async (projectPath) => {
        await writeReadmeFile(projectPath, 'shot-ext', noopLogger)
        const contents = await fsp.readFile(
          path.join(projectPath, 'README.md'),
          'utf8'
        )
        expect(contents).toContain('![screenshot](./public/screenshot.png)')
      }
    )

    await withTempProject(
      async (projectPath) => {
        await fsp.writeFile(
          path.join(projectPath, 'manifest.json'),
          JSON.stringify({manifest_version: 3, description: 'no screenshot'})
        )
      },
      async (projectPath) => {
        await writeReadmeFile(projectPath, 'plain-ext', noopLogger)
        const contents = await fsp.readFile(
          path.join(projectPath, 'README.md'),
          'utf8'
        )
        expect(contents).not.toContain('![screenshot]')
      }
    )
  })

  it('omits the description blockquote when manifest has no description', async () => {
    await withTempProject(
      async (projectPath) => {
        await fsp.writeFile(
          path.join(projectPath, 'manifest.json'),
          JSON.stringify({manifest_version: 3})
        )
      },
      async (projectPath) => {
        await writeReadmeFile(projectPath, 'no-desc', noopLogger)
        const contents = await fsp.readFile(
          path.join(projectPath, 'README.md'),
          'utf8'
        )
        expect(contents).toContain('# no-desc')
        expect(contents).not.toMatch(/^>\s/m)
      }
    )
  })
})
