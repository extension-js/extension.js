//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type ChildProcess, spawn as spawnNode} from 'node:child_process'
import {createRequire} from 'node:module'
import {spawn as crossSpawn} from 'cross-spawn'
import {
  endProcessTree,
  forwardEndingSignals,
  type SpawnProcess,
  signalProcessGroup
} from './install-runner'

// go-git-it starts git with no handle to end it, so it runs in a child that
// leads its own group and can be ended with every git it started.
// The job rides in the environment: go-git-it runs as its own CLI when the
// first argument names its entry file.
const CLONE_JOB = 'EXTENSION_CREATE_CLONE_JOB'
const CLONE_SCRIPT = `
const [entry, url, destination, message] = JSON.parse(process.env.${CLONE_JOB})
const loaded = require(entry)
const goGitIt = loaded.default || loaded
goGitIt(url, destination, message).then(
  () => process.exit(0),
  (error) => {
    const failed = error && error.message ? error.message : String(error)
    if (process.send) process.send({failed}, () => process.exit(1))
    else process.exit(1)
  }
)
`

export interface CloneInChildOptions {
  signal?: AbortSignal
  // Shows the clone's own output as it arrives, for development.
  show?: boolean
  platform?: NodeJS.Platform
  // Starts taskkill on Windows, cross-spawn unless given.
  spawn?: SpawnProcess
}

function goGitItEntry(): string {
  return createRequire(__filename).resolve('go-git-it')
}

export function cloneInChild(
  url: string,
  destination: string,
  message: string,
  options: CloneInChildOptions = {}
): Promise<void> {
  const platform = options.platform ?? process.platform
  const ownGroup = platform !== 'win32'

  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason)

      return
    }

    let child: ChildProcess

    try {
      child = spawnNode(process.execPath, ['-e', CLONE_SCRIPT], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          [CLONE_JOB]: JSON.stringify([
            goGitItEntry(),
            url,
            destination,
            message
          ])
        },
        windowsHide: true,
        ...(ownGroup ? {detached: true} : {})
      })
    } catch (error) {
      reject(error)

      return
    }

    let stderr = ''
    let failed: string | undefined
    let settled = false

    const release =
      ownGroup && child.pid !== undefined
        ? forwardEndingSignals(child.pid, signalProcessGroup)
        : () => {}

    const finish = (error?: unknown) => {
      if (settled) return

      settled = true
      release()
      options.signal?.removeEventListener('abort', onAbort)

      if (error === undefined) resolve()
      else reject(error)
    }

    const onAbort = () => {
      release()
      endProcessTree(
        child,
        options.spawn ?? crossSpawn,
        platform,
        ownGroup ? signalProcessGroup : undefined
      )

      // Neither the pipes nor the channel may keep the create from ending.
      child.stdout?.destroy()
      child.stderr?.destroy()
      if (child.connected) child.disconnect()

      child.unref()
      finish(options.signal?.reason)
    }

    options.signal?.addEventListener('abort', onAbort, {once: true})

    child.stdout?.on('data', (chunk) => {
      if (options.show) process.stdout.write(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (options.show) process.stderr.write(chunk)
    })

    child.on('message', (payload) => {
      const reason = (payload as {failed?: unknown} | null)?.failed
      if (typeof reason === 'string') failed = reason
    })

    child.on('error', (error) => finish(error))

    child.on('close', (code) => {
      if (code === 0) {
        finish()

        return
      }

      finish(
        new Error(
          failed ||
            stderr.trim() ||
            `The clone ended with exit code ${String(code)}`
        )
      )
    })
  })
}
