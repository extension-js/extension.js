import {EventEmitter} from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createSafariPackager} from '../../extension/browsers/run-safari/safari-packager'
import {trackTempFolders} from './helpers/temp-folders'

// The real packager on a real build, with only its child processes replaced:
// no Xcode tool runs, and the converter stand-in answers with a failure.
const children = vi.hoisted(() => ({
  packaging: false,
  ran: [] as string[]
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()

  const spawnSync = (bin: string, args: string[], ...rest: unknown[]) => {
    if (!children.packaging) {
      return (actual.spawnSync as (...all: unknown[]) => unknown)(
        bin,
        args,
        ...rest
      )
    }

    children.ran.push([bin, ...args].join(' '))

    return {
      status: 0,
      stdout:
        bin === 'xcode-select'
          ? '/Applications/Xcode.app/Contents/Developer\n'
          : `/stand-in/${args[1]}\n`,
      stderr: ''
    }
  }

  const spawn = (bin: string, args: string[], ...rest: unknown[]) => {
    if (!children.packaging) {
      return (actual.spawn as (...all: unknown[]) => unknown)(
        bin,
        args,
        ...rest
      )
    }

    children.ran.push([bin, ...args].join(' ').slice(0, 40))

    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter()
    })

    setImmediate(() => {
      child.stderr.emit('data', 'error: the converter stand-in refused')
      child.emit('close', 1)
    })

    return child
  }

  return {...actual, spawn, spawnSync, default: {...actual, spawn, spawnSync}}
})

const tempFolder = trackTempFolders()

afterEach(() => {
  children.packaging = false
  children.ran.length = 0
  vi.restoreAllMocks()
})

const plain = (text: string) =>
  // eslint-disable-next-line no-control-regex
  text.replace(/\u001b\[[0-9;]*m/g, '')

function project() {
  const root = fs.realpathSync(tempFolder('extjs-safari-packager-'))
  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(root, file), text)

  write(
    'package.json',
    JSON.stringify({private: true, name: 'packaged', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'packaged',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  write('background.js', 'console.log(1)\n')

  return root
}

describe('build: a Safari packaging tool that fails (real rspack, real packager)', () => {
  it('prints the failure once, from the packager, and rejects with its code', async () => {
    const {extensionBuild} = await import('../command-build')
    const root = project()
    const packager = createSafariPackager({browser: 'safari', noOpen: true})
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    const stderr: string[] = []

    vi.spyOn(console, 'log').mockImplementation(() => {})

    for (const method of ['warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...parts) => {
        stderr.push(parts.map(String).join(' '))
      })
    }

    const failure = await extensionBuild(root, {
      browser: 'safari',
      install: false,
      mode: 'production',
      silent: true,
      // The packager only looks for its tools on macOS, so the build runs
      // as the host it is and the packager alone sees a Mac.
      safariPackager: async (...args) => {
        Object.defineProperty(process, 'platform', {value: 'darwin'})
        children.packaging = true

        try {
          return await packager(...args)
        } finally {
          children.packaging = false
          if (platform) Object.defineProperty(process, 'platform', platform)
        }
      }
    } as never).then(
      () => undefined,
      (reason: Error & {code?: string}) => reason
    )

    expect(failure?.code).toBe('E_SAFARI_TOOLCHAIN')
    expect(failure?.message).toBe(
      'safari-web-extension-converter failed (exit 1)\n' +
        'error: the converter stand-in refused'
    )

    const said = plain(stderr.join('\n'))

    expect(said.split('the converter stand-in refused')).toHaveLength(2)
    expect(said).toContain(
      'Safari packaging tool safari-web-extension-converter failed (exit 1).'
    )

    expect(said.split('\n').at(-1)).toMatch(/ Build failed with 1 error\.$/)

    // Every process the packager asked for was a stand-in.
    expect(children.ran[0]).toBe('xcode-select -p')
    expect(children.ran.filter((ran) => ran.startsWith('xcrun '))).toHaveLength(
      3
    )

    expect(children.ran).toHaveLength(4)
  }, 120_000)
})
