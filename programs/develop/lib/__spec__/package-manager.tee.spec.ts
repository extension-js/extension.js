import {Writable} from 'node:stream'
import {describe, expect, it} from 'vitest'
import {execInstallCommand} from '../package-manager'

function sink() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk))
      done()
    }
  })

  return {stream, text: () => chunks.join('')}
}

function script(code: string): string[] {
  return ['-e', code]
}

describe('execInstallCommand with a tee', () => {
  it('prints both streams as they come and keeps them on the rejection', async () => {
    const out = sink()
    const err = sink()

    const error: any = await execInstallCommand(
      process.execPath,
      script(
        "process.stdout.write('Progress: resolved 1\\n'); process.stderr.write('npm error code E404\\n'); process.exitCode = 7"
      ),
      {tee: {stdout: out.stream, stderr: err.stream}}
    ).catch((caught) => caught)

    expect(out.text()).toBe('Progress: resolved 1\n')
    expect(err.text()).toBe('npm error code E404\n')
    expect(error.message).toBe('Install failed with exit code 7')
    expect(error.exitCode).toBe(7)
    expect(error.output).toContain('Progress: resolved 1')
    expect(error.output).toContain('npm error code E404')
  })

  it('keeps only the tail of a long output, where the error is', async () => {
    const out = sink()
    const err = sink()

    const error: any = await execInstallCommand(
      process.execPath,
      script(
        "process.stdout.write('x'.repeat(200000) + 'THE END'); process.exitCode = 1"
      ),
      {tee: {stdout: out.stream, stderr: err.stream}}
    ).catch((caught) => caught)

    expect(out.text()).toHaveLength(200007)
    expect(error.output.length).toBeLessThanOrEqual(64 * 1024)
    expect(error.output).toContain('THE END')
  })

  it('resolves and prints when the command succeeds', async () => {
    const out = sink()
    const err = sink()

    await execInstallCommand(
      process.execPath,
      script("process.stdout.write('added 1 package\\n')"),
      {tee: {stdout: out.stream, stderr: err.stream}}
    )

    expect(out.text()).toBe('added 1 package\n')
    expect(err.text()).toBe('')
  })

  it('carries no output when the caller did not ask for a tee', async () => {
    const error: any = await execInstallCommand(
      process.execPath,
      script('process.exitCode = 3')
    ).catch((caught) => caught)

    expect(error.exitCode).toBe(3)
    expect(error.output).toBeUndefined()
  })
})
