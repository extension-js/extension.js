export interface RdpFrameParseResult<T = unknown> {
  remainingData: Buffer
  parsedMessage?: T
  error?: Error
  fatal?: boolean
}

export function parseRdpFrame<T = unknown>(
  data: Buffer
): RdpFrameParseResult<T> {
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
    const parsedMessage = JSON.parse(messageContent.toString()) as T

    return {remainingData, parsedMessage}
  } catch (error: unknown) {
    return {remainingData, error: error as Error, fatal: false}
  }
}

export function buildRdpFrame(obj: unknown) {
  const body = JSON.stringify(obj as Record<string, unknown>)
  const len = Buffer.from(body).length

  return `${len}:${body}`
}
