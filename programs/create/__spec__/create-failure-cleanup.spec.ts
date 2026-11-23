import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {shellQuote} from '../lib/utils'
import {type CreateSeams, runCreate} from '../run-create'
import {
  buildExamplesArchive,
  fixtureExtensionFiles
} from './examples-catalog-fixture'
import {type LoopbackServer, serveLoopback} from './loopback-template-server'

// The default template, with a .gitignore so the import edits an owner's own.
const catalogArchive = buildExamplesArchive({
  typescript: {
    ...fixtureExtensionFiles('typescript'),
    '.gitignore': 'node_modules\ndist\n'
  }
})

const noopLogger = {log: () => {}, error: () => {}}
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const GLYPH = '⏵⏵⏵'

type FailedCreate = Error & {cause?: unknown}

// Resolves with the rejection, its frame split into uncolored lines.
async function failedCreate(run: Promise<unknown>) {
  const error = (await run.then(
    () => new Error('the create did not fail'),
    (thrown: Error) => thrown
  )) as FailedCreate
  const frame = String(error.message).replace(ANSI, '')

  return {error, frame, lines: frame.split('\n')}
}

// A removal the filesystem refuses, as a folder held open elsewhere would.
function busy(target: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`EBUSY: resource busy or locked, rm '${target}'`),
    {code: 'EBUSY', syscall: 'rm', path: target}
  )
}

// Every step that makes the scaffold the user's own runs after the install, so
// an install the package manager refuses is what left a half-made project.
const refusedInstall: CreateSeams = {
  runInstall: async () => ({
    code: 1,
    stdout: '',
    stderr: 'npm error code ECONNREFUSED\n'
  }),
  probeVersion: () => ({status: 1, stdout: ''})
}

// Each cell runs a whole create on disk, which a loaded Windows runner can
// stretch well past the 5 s default.
describe('a failed create leaves nothing half-personalized on disk', {
  timeout: 30_000
}, () => {
  const savedEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
    EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
  }
  const tempRoots: string[] = []
  let catalog: LoopbackServer

  beforeEach(async () => {
    catalog = await serveLoopback({'/catalog.zip': {body: catalogArchive}})
    process.env.EXTENSION_ENV = 'test'
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url('/catalog.zip')
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    await catalog.close()

    while (tempRoots.length > 0) {
      await fsp.rm(tempRoots.pop()!, {recursive: true, force: true})
    }
  })

  async function makeTempRoot() {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'extjs-create-cleanup-')
    )
    tempRoots.push(tmpRoot)

    return tmpRoot
  }

  it('removes the directory it created, so a retry is not refused', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'proof')

    await expect(
      runCreate(
        projectPath,
        {install: true, logger: noopLogger},
        refusedInstall
      )
    ).rejects.toThrow("Couldn't install the dependencies")

    expect(catalog.hits('/catalog.zip')).toBe(1)

    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('keeps what pre-existed and drops only what the run wrote', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'existing-repo')
    await fsp.mkdir(path.join(projectPath, '.git'), {recursive: true})
    await fsp.writeFile(
      path.join(projectPath, '.git', 'HEAD'),
      'ref: refs/heads/main\n'
    )

    await expect(
      runCreate(
        projectPath,
        {install: true, logger: noopLogger},
        refusedInstall
      )
    ).rejects.toThrow("Couldn't install the dependencies")

    expect(catalog.hits('/catalog.zip')).toBe(1)

    expect(fs.existsSync(path.join(projectPath, '.git', 'HEAD'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, 'node_modules'))).toBe(false)
  })

  it('puts the owner .gitignore back byte for byte', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'existing-repo')
    const ownerRules = Buffer.from('# mine\r\n.idea/\r\n*.log')
    await fsp.mkdir(path.join(projectPath, '.git'), {recursive: true})
    await fsp.writeFile(path.join(projectPath, '.gitignore'), ownerRules)

    await expect(
      runCreate(
        projectPath,
        {install: true, logger: noopLogger},
        refusedInstall
      )
    ).rejects.toThrow("Couldn't install the dependencies")

    expect(catalog.hits('/catalog.zip')).toBe(1)

    const after = await fsp.readFile(path.join(projectPath, '.gitignore'))
    expect(after.equals(ownerRules)).toBe(true)
  })

  // A template is a folder someone else wrote. One whose package.json does not
  // parse used to be scaffolded with a minimal one in its place when nothing
  // was installed, and to fail with a bare SyntaxError when something was.
  describe('from a template whose package.json does not parse', () => {
    async function brokenTemplate(tmpRoot: string) {
      const template = path.join(tmpRoot, 'broken-template')
      await fsp.mkdir(template)
      await fsp.writeFile(
        path.join(template, 'manifest.json'),
        JSON.stringify({name: 'broken', manifest_version: 3, version: '1.0.0'})
      )

      await fsp.writeFile(
        path.join(template, 'package.json'),
        '{"name": "broken", "dependencies": {"react": "^19.0.0"}'
      )

      return template
    }

    it.each([
      ['with install on', true],
      ['with install off', false]
    ])('refuses %s, with one frame, nothing installed and nothing left', async (_label, install) => {
      const tmpRoot = await makeTempRoot()
      const template = await brokenTemplate(tmpRoot)
      const projectPath = path.join(tmpRoot, 'proof')
      const installs: string[] = []
      const errors: unknown[] = []

      const {error, lines} = await failedCreate(
        runCreate(
          projectPath,
          {
            template,
            install,
            logger: {log() {}, error: (...args) => errors.push(args)}
          },
          {
            runInstall: async (command, args) => {
              installs.push([command, ...args].join(' '))

              return {code: 0, stdout: '', stderr: ''}
            },
            probeVersion: () => ({status: 1, stdout: ''})
          }
        )
      )

      expect(lines.slice(0, 2)).toEqual([
        `${GLYPH} Error: Couldn't read the template's package.json.`,
        `PATH ${path.join(projectPath, 'package.json')}`
      ])

      expect(lines[2]).toBe(
        'REASON unexpected end of the file at line 1 column 56'
      )

      expect(lines[3]).toBe('Fix that file in the template, then create again.')
      expect(lines).toHaveLength(4)
      expect(error.cause).toBeInstanceOf(SyntaxError)
      expect(errors).toEqual([])
      expect(installs).toEqual([])
      expect(fs.existsSync(projectPath)).toBe(false)
      // The template itself is the author's and stays as it was.
      expect(fs.existsSync(path.join(template, 'package.json'))).toBe(true)
      expect(catalog.hits('/catalog.zip')).toBe(0)
    })
  })

  describe('when removing the half-made project fails too', () => {
    it('keeps the install frame, drops its removal claim and names the folder left', async () => {
      const tmpRoot = await makeTempRoot()
      const projectPath = path.join(tmpRoot, 'proof')
      const asked: string[] = []

      const {error, frame, lines} = await failedCreate(
        runCreate(
          projectPath,
          {install: true, logger: noopLogger},
          {
            ...refusedInstall,
            remove: async (target) => {
              asked.push(target)

              throw busy(target)
            }
          }
        )
      )

      expect(lines[0]).toBe(
        `${GLYPH} Error: Couldn't install the dependencies.`
      )

      expect(frame).toContain('REASON npm error code ECONNREFUSED')
      // The claim the install frame makes is no longer true, so it is gone.
      expect(frame).not.toContain('The new project files were removed')
      expect(lines.slice(-3)).toEqual([
        `Fix the error above, then run extension create ${shellQuote(projectPath)} --install again.`,
        "Couldn't remove the new project files. Delete what is left before you create again.",
        `   - ${projectPath}`
      ])

      expect(frame.match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
      expect(error.name).toBe('Error')
      expect(asked).toEqual([projectPath])
      expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)
    })

    // The import cleans up after itself and the create cleans up again, so
    // the same leftovers are met twice and must be told once.
    it('names the leftovers once when the import and the create both meet them', async () => {
      const tmpRoot = await makeTempRoot()
      const projectPath = path.join(tmpRoot, 'proof')
      const asked: string[] = []

      const {error, frame, lines} = await failedCreate(
        runCreate(
          projectPath,
          {template: 'not-in-the-catalog', logger: noopLogger},
          {
            remove: async (target) => {
              asked.push(target)

              throw busy(target)
            }
          }
        )
      )

      expect(error.name).toBe('TemplateNotFoundError')
      expect(lines[0]).toBe(
        `${GLYPH} Error: The template not-in-the-catalog is not in the extension-js/templates catalog.`
      )

      expect(lines.slice(-2)).toEqual([
        "Couldn't remove the new project files. Delete what is left before you create again.",
        `   - ${projectPath}`
      ])

      expect(
        frame.match(/Couldn't remove the new project files/g)
      ).toHaveLength(1)

      expect(frame.match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
      expect(asked).toEqual([projectPath, projectPath])
    })

    it('in a folder that pre-existed, names each entry left and each owner file not put back', async () => {
      const tmpRoot = await makeTempRoot()
      const projectPath = path.join(tmpRoot, 'existing-repo')
      const gitignorePath = path.join(projectPath, '.gitignore')
      await fsp.mkdir(path.join(projectPath, '.git'), {recursive: true})
      await fsp.writeFile(gitignorePath, '# mine\n')

      const {frame, lines} = await failedCreate(
        runCreate(
          projectPath,
          {install: true, logger: noopLogger},
          {
            ...refusedInstall,
            // Everything goes but package.json, and a folder lands where the
            // owner's .gitignore must be written back.
            remove: async (target) => {
              if (path.basename(target) === 'package.json') {
                await fsp.rm(gitignorePath, {force: true})
                await fsp.mkdir(gitignorePath, {recursive: true})

                throw busy(target)
              }

              await fsp.rm(target, {recursive: true, force: true})
            }
          }
        )
      )

      expect(lines[0]).toBe(
        `${GLYPH} Error: Couldn't install the dependencies.`
      )

      expect(frame).not.toContain('The new project files were removed')
      expect(lines.slice(-4)).toEqual([
        "Couldn't remove the new project files. Delete what is left before you create again.",
        `   - ${path.join(projectPath, 'package.json')}`,
        "Couldn't put back the files this folder already had. Check them before you create again.",
        `   - ${gitignorePath}`
      ])

      expect(frame.match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
      expect(fs.existsSync(path.join(projectPath, '.git'))).toBe(true)
    })
  })
})
