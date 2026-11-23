import {describe, expect, it} from 'vitest'
import {
  readWindowsProductVersion,
  WINDOWS_VERSION_READ_TIMEOUT_MS
} from '../../browsers-lib/binary-version-metadata'

type Asked = {
  bin: string
  args: string[]
  env: Record<string, string | undefined>
  timeout: number
}

function runner(answer: {status: number | null; stdout: string | null}) {
  const asked: Asked[] = []

  return {
    asked,
    run: (
      bin: string,
      args: string[],
      options: {env: Record<string, string | undefined>; timeout: number}
    ) => {
      asked.push({bin, args, env: options.env, timeout: options.timeout})

      return answer
    }
  }
}

describe('the version read off a Windows binary', () => {
  it('asks .NET for the product version and loads no module to do it', () => {
    const {asked, run} = runner({status: 0, stdout: '151.0.7922.71\r\n'})

    expect(readWindowsProductVersion('C:\\b\\chrome.exe', run, {})).toBe(
      '151.0.7922.71'
    )

    expect(asked).toHaveLength(1)
    expect(asked[0].bin).toBe('powershell.exe')
    expect(asked[0].args.slice(0, 3)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command'
    ])

    expect(asked[0].args[3]).toContain(
      '[System.Diagnostics.FileVersionInfo]::GetVersionInfo('
    )

    expect(asked[0].args[3]).not.toMatch(/Get-Item|Get-Command|Import-Module/)
  })

  it('never writes the path into the script, whatever it holds', () => {
    const hostile = "C:\\b\\it's'); Remove-Item C:\\ -Recurse; ('.exe"
    const {asked, run} = runner({status: 0, stdout: ''})

    readWindowsProductVersion(hostile, run, {KEPT: '1'})

    expect(asked[0].args.join(' ')).not.toContain('Remove-Item')
    expect(asked[0].args.join(' ')).not.toContain("it's")
    expect(Object.values(asked[0].env)).toContain(hostile)
    expect(asked[0].env.KEPT).toBe('1')
  })

  it('bounds the read, and a read that fails or runs out answers nothing', () => {
    const failed = runner({status: 1, stdout: 'not a version'})
    const timedOut = runner({status: null, stdout: null})

    expect(readWindowsProductVersion('C:\\nope.exe', failed.run, {})).toBe('')
    expect(readWindowsProductVersion('C:\\slow.exe', timedOut.run, {})).toBe('')
    expect(failed.asked[0].timeout).toBe(WINDOWS_VERSION_READ_TIMEOUT_MS)
    expect(WINDOWS_VERSION_READ_TIMEOUT_MS).toBe(5000)

    expect(
      readWindowsProductVersion(
        'C:\\b.exe',
        () => {
          throw new Error('spawn EPERM')
        },
        {}
      )
    ).toBe('')
  })
})
