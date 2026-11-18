import {setupCleanupHandlers} from '../../cleanup'
import type {PortManager} from '../../port-manager'

const portManager = {
  terminateCurrentInstance: async () => {}
} as unknown as PortManager

const mode = process.argv[2]

// A server whose stop never settles, as a hung watcher or socket leaves it.
const hungServer = {stop: () => new Promise<void>(() => {})}

setupCleanupHandlers(
  () => (mode === 'hang' ? (hungServer as never) : null),
  portManager,
  undefined,
  mode === 'hang' ? {shutdownTimeoutMs: 300} : {}
)

// Nothing else keeps this process alive, and closeAll's own timer ends it.
const keepAlive = setInterval(() => {}, 1000)

if (mode === 'throw') {
  setTimeout(() => {
    throw new Error('dev session blew up')
  }, 10)
} else {
  setTimeout(() => {
    // The hung server is what would keep a real session alive.
    if (mode !== 'hang') clearInterval(keepAlive)

    // A real signal where the OS has them. On Windows process.kill terminates
    // the target outright, so the handler under test would never run.
    if (process.platform === 'win32') process.emit('SIGINT', 'SIGINT')
    else process.kill(process.pid, 'SIGINT')
  }, 10)
}
