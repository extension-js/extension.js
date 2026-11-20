import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {createDirectory} from '../create-directory'
import {
  noteIncompleteCleanup,
  putBackOwnerHiddenFiles
} from '../import-external-template'

const roots: string[] = []

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cleanup-paths-'))
  roots.push(root)

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.chmodSync(root, 0o700)

    for (const entry of fs.readdirSync(root)) {
      const target = path.join(root, entry)
      if (fs.statSync(target).isDirectory()) fs.chmodSync(target, 0o700)
    }

    fs.rmSync(root, {recursive: true, force: true})
  }
})

const logger = {log: () => {}, error: () => {}}

describe('the create catch paths no fault injection reached', () => {
  // A folder that takes writes but refuses a listing fails after the write
  // probe, in the generic catch.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'frames a destination that cannot be listed as one to check',
    async () => {
      const projectPath = path.join(tempRoot(), 'unlistable')
      fs.mkdirSync(projectPath)
      fs.chmodSync(projectPath, 0o300)

      const failure = await createDirectory(
        projectPath,
        'unlistable',
        logger
      ).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(Error)
      expect(String((failure as Error).message)).toMatch(
        /Couldn't create the directory .*unlistable[\s\S]*EACCES[\s\S]*Check the path and its permissions/
      )

      expect(failure).toMatchObject({code: 'E_DESTINATION_NOT_WRITABLE'})
    }
  )

  it('answers an owner .mcp.json that could not be written back', async () => {
    const projectPath = tempRoot()
    // A directory where the file was is a write that fails on every OS.
    fs.mkdirSync(path.join(projectPath, '.mcp.json'))

    const notRestored = await putBackOwnerHiddenFiles(projectPath, {
      gitignore: 'node_modules\n',
      mcpConfig: Buffer.from('{"mcpServers":{}}\n')
    })

    expect(notRestored).toEqual([path.join(projectPath, '.mcp.json')])
    expect(fs.readFileSync(path.join(projectPath, '.gitignore'), 'utf8')).toBe(
      'node_modules\n'
    )
  })

  it('still says what was left when the failure is not an Error', () => {
    const thrown = noteIncompleteCleanup('git exited with 128', {
      leftBehind: ['/tmp/project/src'],
      notRestored: []
    })

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(
      /git exited with 128[\s\S]*Couldn't remove the new project files[\s\S]*\/tmp\/project\/src/
    )

    expect((thrown as Error).cause).toBe('git exited with 128')
  })

  it('hands back a non-Error untouched when nothing was left', () => {
    expect(
      noteIncompleteCleanup('plain', {leftBehind: [], notRestored: []})
    ).toBe('plain')
  })
})
