export function parseRdpFrame(data: Buffer): {
  remainingData: Buffer
  parsedMessage?: any
  error?: Error
  fatal?: boolean
} {
  const dataString = data.toString()
  const separatorIndex = dataString.indexOf(':')
  if (separatorIndex < 1) return {remainingData: data}
  const lenStr = dataString.substring(0, separatorIndex)
  const messageLength = parseInt(lenStr, 10)
  if (isNaN(messageLength)) {
    return {
      remainingData: data,
      error: new Error('Invalid RDP frame length'),
      fatal: true
    }
  }
  if (data.length - (separatorIndex + 1) < messageLength) {
    return {remainingData: data}
  }
  const messageContent = data.slice(
    separatorIndex + 1,
    separatorIndex + 1 + messageLength
  )
  const remainingData = data.slice(separatorIndex + 1 + messageLength)
  try {
    const parsedMessage = JSON.parse(messageContent.toString())
    return {remainingData, parsedMessage}
  } catch (error: any) {
    return {remainingData, error, fatal: false}
  }
}

export function buildRdpFrame(obj: any): string {
  const body = JSON.stringify(obj)
  const len = Buffer.from(body).length
  return `${len}:${body}`
}
