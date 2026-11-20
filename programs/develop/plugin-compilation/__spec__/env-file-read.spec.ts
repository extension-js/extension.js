import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {EnvPlugin} from '../env'
import {
  createCompiler,
  makeTempRoot,
  removeTempRoots,
  writeFiles
} from './helpers/real-compile'

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')

function compilerError(root: string): {code?: unknown; message: string} {
  try {
    createCompiler({
      context: root,
      outputPath: path.join(root, 'out'),
      entry: {entry: './entry.js'},
      plugins: [new EnvPlugin({browser: 'chrome'})]
    }).close(() => {})
  } catch (error) {
    const thrown = error as {code?: unknown; message: string}

    return {code: thrown.code, message: stripAnsi(thrown.message)}
  }

  throw new Error('the compiler was created')
}

afterAll(() => {
  removeTempRoots()
})

describe('an env file the build cannot read', () => {
  it('names a .env folder by its path in the project, with a code', () => {
    const root = makeTempRoot('env-folder')
    writeFiles(root, {'entry.js': 'console.log(1)\n', '.env/keep': ''})

    expect(compilerError(root)).toEqual({
      code: 'E_ENV_FILE_UNREADABLE',
      message:
        '.env is a folder, and the build reads every .env file that matches its browser and mode.\n' +
        'Rename or remove the folder, or turn it into a file of NAME=value lines.'
    })
  })

  it('names a .env.defaults folder the same way', () => {
    const root = makeTempRoot('env-defaults-folder')
    writeFiles(root, {
      'entry.js': 'console.log(1)\n',
      '.env.chrome': 'EXTENSION_PUBLIC_A=1\n',
      '.env.defaults/keep': ''
    })

    expect(compilerError(root)).toMatchObject({
      code: 'E_ENV_FILE_UNREADABLE',
      message: expect.stringMatching(/^\.env\.defaults is a folder,/)
    })
  })

  // A root user reads any file, and Windows has no mode bits to take away.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'names a file without read permission, with the same code',
    () => {
      const root = makeTempRoot('env-unreadable')
      writeFiles(root, {
        'entry.js': 'console.log(1)\n',
        '.env': 'EXTENSION_PUBLIC_A=1\n'
      })

      fs.chmodSync(path.join(root, '.env'), 0o000)

      try {
        expect(compilerError(root)).toEqual({
          code: 'E_ENV_FILE_UNREADABLE',
          message:
            '.env cannot be read, and the build reads every .env file that matches its browser and mode.\n' +
            'Give it read permission, or remove it.'
        })
      } finally {
        fs.chmodSync(path.join(root, '.env'), 0o644)
      }
    }
  )
})
