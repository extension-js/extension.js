// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface UtilityTabTransport {
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number
  ): Promise<unknown>
}

const NEW_TAB_PAGE = 'chrome://newtab/'

// A cold browser answers the debugger before it has opened its own window, so
// a tab this session opened can be the only one. A browser quits with its last
// tab, so a new tab page takes its place before that one is closed.
export async function closeUtilityTab(
  transport: UtilityTabTransport,
  targetId: string
): Promise<void> {
  let alone = false

  try {
    const listed = (await transport.sendCommand('Target.getTargets')) as
      | {targetInfos?: Array<{targetId?: string; type?: string}>}
      | undefined

    const pages = (listed?.targetInfos ?? []).filter(
      (target) => target?.type === 'page'
    )

    alone =
      pages.length > 0 && pages.every((target) => target.targetId === targetId)
  } catch {
    // An unread list closes the tab as before.
  }

  if (alone) {
    const kept = (await transport.sendCommand('Target.createTarget', {
      url: NEW_TAB_PAGE
    })) as {targetId?: string} | undefined

    if (!kept?.targetId) return
  }

  await transport.sendCommand('Target.closeTarget', {targetId})
}
