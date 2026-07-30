import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {writeManifestJson} from '../write-manifest-json'

async function withProject(
  manifest: Record<string, unknown>,
  fn: (projectPath: string) => Promise<void>
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-manifest-'))
  const projectPath = path.join(dir, 'my-extension')
  await fs.mkdir(path.join(projectPath, 'src'), {recursive: true})
  await fs.writeFile(
    path.join(projectPath, 'src', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
  try {
    await fn(projectPath)
  } finally {
    await fs.rm(dir, {recursive: true, force: true})
  }
}

describe('writeManifestJson', () => {
  it('replaces the template name with the project name', async () => {
    await withProject(
      {name: 'JavaScript Sidebar Example', version: '1.0.0'},
      async (projectPath) => {
        await writeManifestJson(projectPath, console)
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(projectPath, 'src', 'manifest.json'),
            'utf8'
          )
        )
        expect(manifest.name).toBe('my-extension')
      }
    )
  })

  it('returns the name the template shipped so STORE.md can follow', async () => {
    await withProject(
      {name: 'JavaScript Sidebar Example', version: '1.0.0'},
      async (projectPath) => {
        const templateName = await writeManifestJson(projectPath, console)
        expect(templateName).toBe('JavaScript Sidebar Example')
      }
    )
  })

  it('stamps no author it cannot prove', async () => {
    await withProject(
      {name: 'JavaScript Sidebar Example', version: '1.0.0'},
      async (projectPath) => {
        await writeManifestJson(projectPath, console)
        const raw = await fs.readFile(
          path.join(projectPath, 'src', 'manifest.json'),
          'utf8'
        )
        expect(raw).not.toContain('Your Name')
        expect(JSON.parse(raw).author).toBeUndefined()
      }
    )
  })

  it("drops the template author's identity", async () => {
    await withProject(
      {name: 'Example', version: '1.0.0', author: {email: 'someone@else.dev'}},
      async (projectPath) => {
        await writeManifestJson(projectPath, console)
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(projectPath, 'src', 'manifest.json'),
            'utf8'
          )
        )
        expect(manifest.author).toBeUndefined()
      }
    )
  })
})
