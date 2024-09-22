import * as crypto from 'crypto'

function hashString(input: string): string {
  // Hash the input using SHA-256
  return crypto.createHash('sha256').update(input).digest('hex')
}

document.getElementById('hash-button')?.addEventListener('click', () => {
  const inputText = (document.getElementById('input-text') as HTMLInputElement)
    .value
  const hashedOutput = hashString(inputText)

  const outputElement = document.getElementById('hashed-output')
  if (outputElement) {
    outputElement.textContent = hashedOutput
  }
})
