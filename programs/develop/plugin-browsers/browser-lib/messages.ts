import {bold, bgWhite, red} from '@colors/colors/safe'

export function watchModeClosed(browser: string, code: number, reason: Buffer) {
  const message = reason.toString()
  return (
    `[😓] ${bgWhite(` ${browser}-browser `)} ${red(
      '✖︎✖︎✖︎'
    )} Watch mode closed (code ${code}). ` +
    `${message && '\n\nReason ' + message + '\n'}Exiting...\n`
  )
}

export function browserNotFound(browser: string, binaryPath: string) {
  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
  return `${bgWhite(` ${browser}-browser `)} ${red(
    '✖︎✖︎✖︎'
  )} ${capitalize(browser)} not found at ${binaryPath}`
}

export function webSocketError(browser: string, error: any) {
  error(
    `[⛔️] ${bgWhite(` ${browser}-browser `)} ${red(
      '✖︎✖︎✖︎'
    )} WebSocket error`,
    error
  )
}

export function parseFileError(browser: string, error: any, filepath: string) {
  return (
    `[⛔️] ${bgWhite(` ${browser}-browser `)} ${red('✖︎✖︎✖︎')} ` +
    `Error parsing file: ${filepath}. Reason: ${error.message}`
  )
}
