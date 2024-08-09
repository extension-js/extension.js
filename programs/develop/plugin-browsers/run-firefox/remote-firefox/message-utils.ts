export function requestErrorToMessage(err: any) {
  if (err instanceof Error) {
    return String(err)
  }
  return `${err.error}: ${err.message}`
}

export function isErrorWithCode(codeWanted: any, error: any) {
  if (Array.isArray(codeWanted) && codeWanted.includes(error.code)) {
    return true
  } else if (error.code === codeWanted) {
    return true
  }

  return false
}
