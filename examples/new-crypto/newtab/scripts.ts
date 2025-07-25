// Use browser's native crypto API instead of Node.js crypto module
async function hashString(input: string): Promise<string> {
  // Convert string to Uint8Array
  const encoder = new TextEncoder()
  const data = encoder.encode(input)

  // Hash using Web Crypto API
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return hashHex
}

document.getElementById('hash-button')?.addEventListener('click', async () => {
  const inputText = (document.getElementById('input-text') as HTMLInputElement)
    .value
  const hashedOutput = await hashString(inputText)

  const outputElement = document.getElementById('hashed-output')
  if (outputElement) {
    outputElement.textContent = hashedOutput
  }
})
