//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

type ProgressOptions = {
  enabled?: boolean
  intervalMs?: number
  width?: number
  persistLabel?: boolean
}

type ProgressHandle = {
  stop: () => void
}

function clearLine() {
  if (!process.stdout.isTTY) return
  process.stdout.write('\r')
  process.stdout.write('\x1b[2K')
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '')
}

export function shouldShowProgress(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CI
}

export function startProgressBar(
  label: string,
  options?: ProgressOptions
): ProgressHandle {
  const enabled = (options?.enabled ?? true) && shouldShowProgress()

  if (!enabled) {
    return {stop: () => undefined}
  }

  const width = Math.max(10, options?.width ?? 24)
  const intervalMs = Math.max(50, options?.intervalMs ?? 90)
  let tick = 0
  let lastVisibleLength = 0

  const render = () => {
    const filled = tick % (width + 1)
    const empty = width - filled
    const bar = `[${'='.repeat(filled)}${' '.repeat(empty)}]`
    const line = `${label} ${bar}`
    lastVisibleLength = stripAnsi(line).length
    clearLine()
    process.stdout.write(line)
    tick = (tick + 1) % (width + 1)
  }

  render()
  const timer = setInterval(render, intervalMs)

  return {
    stop: () => {
      clearInterval(timer)

      if (process.stdout.isTTY) {
        clearLine()
        if (lastVisibleLength > 0) {
          process.stdout.write(' '.repeat(lastVisibleLength))
          process.stdout.write('\r')
        }
        if (options?.persistLabel) {
          process.stdout.write(`${label}\n`)
        }
      }
    }
  }
}
