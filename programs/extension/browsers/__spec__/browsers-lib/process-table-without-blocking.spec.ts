import {describe, expect, it} from 'vitest'
import {
  listProcessesWithoutBlocking,
  resolveLiveBrowserPid
} from '../../browsers-lib/resolve-live-pid'

describe('the process table read while a browser launches', () => {
  it('lets the session run other work while the table is read', async () => {
    const reading = listProcessesWithoutBlocking()
    let ranMeanwhile = false

    // A read that waited would be settled before this ever ran.
    setImmediate(() => {
      ranMeanwhile = true
    })

    const rows = await reading

    expect(ranMeanwhile).toBe(true)
    expect(rows.map((row) => row.pid)).toContain(process.pid)
  })

  it('answers no rows when the table cannot be read', async () => {
    const rows = await listProcessesWithoutBlocking(
      process.platform,
      async () => null
    )

    expect(rows).toEqual([])
  })

  it('waits for a table that arrives later before it answers', async () => {
    const pid = await resolveLiveBrowserPid({
      profilePath: '/tmp/extjs-profile',
      binary: '/opt/firefox/firefox',
      launcherPid: 100,
      platform: 'linux',
      attempts: 1,
      list: () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  pid: 200,
                  ppid: 1,
                  command: '/opt/firefox/firefox -profile /tmp/extjs-profile'
                }
              ]),
            10
          )
        })
    })

    expect(pid).toBe(200)
  })
})
