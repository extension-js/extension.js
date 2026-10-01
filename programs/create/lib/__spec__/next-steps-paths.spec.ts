import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {scaffoldReady} from '../messages'

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the colors
const ANSI = /\[[0-9;]*m/g

async function nextSteps(
  projectPath: string,
  projectName: string,
  depsInstalled: boolean
) {
  const message = await scaffoldReady(
    projectPath,
    projectName,
    depsInstalled,
    'npm'
  )

  return message.replace(ANSI, '')
}

// The next steps are pasted into a shell, so every line has to survive that.
describe('the next-steps block prints a path a shell can take', () => {
  it('drops the cd step for an in-place create and renumbers the rest', async () => {
    const steps = await nextSteps(process.cwd(), 'my-ext', false)

    expect(steps).not.toContain('cd')
    expect(steps).toContain('1. npm install')
    expect(steps).toContain('2. npm run dev')
  })

  it('drops the cd step for an in-place create with deps installed', async () => {
    const steps = await nextSteps(process.cwd(), 'my-ext', true)

    expect(steps).not.toContain('cd')
    expect(steps).toContain('1. npm run dev')
  })

  it('quotes a relative path that carries whitespace', async () => {
    const steps = await nextSteps(
      path.join(process.cwd(), 'My Extension'),
      'My Extension',
      true
    )

    expect(steps).toContain("1. cd 'My Extension'")
    expect(steps).toContain('2. npm run dev')
  })

  it('quotes a relative path that carries a shell metacharacter', async () => {
    const steps = await nextSteps(
      path.join(process.cwd(), 'ext$(whoami)'),
      'ext',
      true
    )

    expect(steps).toContain("1. cd 'ext$(whoami)'")
  })

  it('leaves a plain relative path unquoted', async () => {
    const steps = await nextSteps(
      path.join(process.cwd(), 'my-ext'),
      'my-ext',
      true
    )

    expect(steps).toContain('1. cd my-ext')
    expect(steps).not.toContain("'my-ext'")
  })
})
