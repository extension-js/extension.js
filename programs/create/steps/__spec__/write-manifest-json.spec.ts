import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {createAddonId, writeManifestJson} from '../write-manifest-json'

// A stand-in for the generated id, so the written shape is pinned here and the
// generator itself is checked once, below.
const FIXED_ID = '{00000000-1111-2222-3333-444444444444}'

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

  // A gecko id IS the add-on, so a template that keeps its own hands every
  // project cut from it the same Firefox identity. It cannot just go either:
  // Firefox requires an id from MV3 on.
  it("replaces the template's Firefox add-on id with the project's own", async () => {
    await withProject(
      {
        name: 'Init Example',
        version: '1.0.0',
        'firefox:browser_specific_settings': {
          gecko: {
            id: 'init@extension.js',
            data_collection_permissions: {required: ['none']}
          }
        }
      },
      async (projectPath) => {
        await writeManifestJson(projectPath, console, () => FIXED_ID)
        const raw = await fs.readFile(
          path.join(projectPath, 'src', 'manifest.json'),
          'utf8'
        )

        expect(raw).not.toContain('init@extension.js')

        const manifest = JSON.parse(raw)
        expect(manifest['firefox:browser_specific_settings'].gecko.id).toBe(
          FIXED_ID
        )

        // Everything else Firefox needs in that block stays put.
        expect(
          manifest['firefox:browser_specific_settings'].gecko
            .data_collection_permissions
        ).toEqual({required: ['none']})
      }
    )
  })

  it('writes a braces GUID, and a fresh one per project', async () => {
    const ids: string[] = []

    for (const _run of [1, 2]) {
      await withProject(
        {
          name: 'Example',
          version: '1.0.0',
          browser_specific_settings: {gecko: {id: 'example@extension.js'}}
        },
        async (projectPath) => {
          await writeManifestJson(projectPath, console)
          const manifest = JSON.parse(
            await fs.readFile(
              path.join(projectPath, 'src', 'manifest.json'),
              'utf8'
            )
          )

          ids.push(manifest.browser_specific_settings.gecko.id)
        }
      )
    }

    // The shape addons-linter accepts, and the shape that claims no domain.
    for (const id of ids) {
      expect(id).toMatch(
        /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/
      )
    }

    expect(ids[0]).not.toBe(ids[1])
  })

  it('writes the id under every spelling of the block, once per manifest', async () => {
    await withProject(
      {
        name: 'Example',
        version: '1.0.0',
        browser_specific_settings: {
          gecko: {id: 'plain@extension.js'},
          gecko_android: {id: 'android@extension.js'}
        },
        applications: {gecko: {id: 'legacy@extension.js'}}
      },
      async (projectPath) => {
        await writeManifestJson(projectPath, console, () => FIXED_ID)
        const raw = await fs.readFile(
          path.join(projectPath, 'src', 'manifest.json'),
          'utf8'
        )

        expect(raw).not.toContain('@extension.js')

        const manifest = JSON.parse(raw)
        // One add-on, so one id across the blocks that describe it.
        expect(manifest.browser_specific_settings.gecko.id).toBe(FIXED_ID)
        expect(manifest.browser_specific_settings.gecko_android.id).toBe(
          FIXED_ID
        )

        expect(manifest.applications.gecko.id).toBe(FIXED_ID)
      }
    )
  })

  it('adds an id to a gecko block that shipped without one', async () => {
    await withProject(
      {
        name: 'Example',
        version: '1.0.0',
        browser_specific_settings: {gecko: {update_url: 'https://x.dev/u.json'}}
      },
      async (projectPath) => {
        await writeManifestJson(projectPath, console, () => FIXED_ID)
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(projectPath, 'src', 'manifest.json'),
            'utf8'
          )
        )

        expect(manifest.browser_specific_settings.gecko.id).toBe(FIXED_ID)
        expect(manifest.browser_specific_settings.gecko.update_url).toBe(
          'https://x.dev/u.json'
        )
      }
    )
  })

  // A template with no gecko block expressed no Firefox opinion, and a block
  // invented here would be ours, not the project's.
  it('invents no gecko block for a manifest that has none', async () => {
    await withProject(
      {name: 'Example', version: '1.0.0', manifest_version: 3},
      async (projectPath) => {
        await writeManifestJson(projectPath, console, () => FIXED_ID)
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(projectPath, 'src', 'manifest.json'),
            'utf8'
          )
        )

        expect(manifest.browser_specific_settings).toBeUndefined()
        expect(manifest.applications).toBeUndefined()
        expect(Object.keys(manifest).sort()).toEqual([
          'manifest_version',
          'name',
          'version'
        ])
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

describe('createAddonId', () => {
  it('returns a lowercase braces GUID that claims no domain', () => {
    const id = createAddonId()

    expect(id).toMatch(
      /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/
    )

    expect(id).not.toContain('@')
    expect(createAddonId()).not.toBe(id)
  })
})
