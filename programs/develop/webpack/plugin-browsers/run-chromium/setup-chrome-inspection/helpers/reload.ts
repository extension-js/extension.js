import {CDPClient} from '../cdp-client'

export async function tryForceReloadExtension(
  cdp: CDPClient,
  extensionId: string
): Promise<boolean> {
  try {
    const ok = await (cdp as any).forceReloadExtension(extensionId)
    return !!ok
  } catch {
    return false
  }
}
