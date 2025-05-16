import * as fs from 'fs'
import * as path from 'path'
import * as messages from '../lib/messages'

let userMessageDelivered = false

export async function loadLoaderOptions(
  projectPath: string,
  framework: 'vue' | 'svelte'
): Promise<any> {
  const loaderPath = path.join(projectPath, `${framework}.loader.js`)
  const moduleLoaderPath = path.join(projectPath, `${framework}.loader.mjs`)

  if (fs.existsSync(loaderPath) || fs.existsSync(moduleLoaderPath)) {
    const configPath = fs.existsSync(loaderPath) ? loaderPath : moduleLoaderPath

    if (!userMessageDelivered) {
      console.log(messages.isUsingCustomLoader(`${framework}.loader.js`))
      userMessageDelivered = true
    }

    try {
      const module = await import(configPath)
      return module.default || module
    } catch (err: unknown) {
      const error = err as Error
      console.error(
        `Error loading ${framework} loader options: ${error.message}`
      )
      throw err
    }
  }

  return null
}
