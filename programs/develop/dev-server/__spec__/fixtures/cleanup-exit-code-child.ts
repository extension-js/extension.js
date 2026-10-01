import {setupCleanupHandlers} from '../../cleanup'
import type {PortManager} from '../../port-manager'

const portManager = {
  terminateCurrentInstance: async () => {}
} as unknown as PortManager

setupCleanupHandlers(() => null, portManager)

// Nothing else keeps this process alive, and closeAll's own timer ends it.
const keepAlive = setInterval(() => {}, 1000)

if (process.argv[2] === 'throw') {
  setTimeout(() => {
    throw new Error('dev session blew up')
  }, 10)
} else {
  setTimeout(() => {
    clearInterval(keepAlive)

    // A real signal where the OS has them. On Windows process.kill terminates
    // the target outright, so the handler under test would never run.
    if (process.platform === 'win32') process.emit('SIGINT', 'SIGINT')
    else process.kill(process.pid, 'SIGINT')
  }, 10)
}
