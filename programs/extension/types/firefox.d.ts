// Firefox-only extension APIs that chrome-types does not declare.
// They merge into the browser namespace chrome-types owns.
declare namespace browser {
  /**
   * The Manifest V2 toolbar button. Firefox keeps it beside `action`,
   * with the same methods and events.
   */
  const browserAction: typeof browser.action

  /**
   * The Firefox sidebar. `open`, `close` and `toggle` only work from a
   * user action handler.
   */
  namespace sidebarAction {
    interface Scope {
      tabId?: number
      windowId?: number
    }

    interface SetIconDetails extends Scope {
      imageData?: ImageData | Record<string, ImageData>
      path?: string | Record<string, string>
    }

    function open(): Promise<void>
    function close(): Promise<void>
    function toggle(): Promise<void>
    function isOpen(details: {windowId?: number}): Promise<boolean>
    function setPanel(details: Scope & {panel: string | null}): Promise<void>
    function getPanel(details: Scope): Promise<string>
    function setTitle(details: Scope & {title: string | null}): Promise<void>
    function getTitle(details: Scope): Promise<string>
    function setIcon(details: SetIconDetails): Promise<void>
  }
}
