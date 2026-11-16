// What chrome-types leaves out for code the browser accepts.
// These merge into the namespaces chrome-types owns.
/// <reference types="chrome-types" />

declare namespace browser.events {
  // A function with no return statement is typed void, and at run time it
  // returns undefined, which these events take.
  // biome-ignore lint/suspicious/noExplicitAny: has to repeat the chrome-types parameter to merge
  export interface Event<H extends (...args: any) => void, C = void, A = void> {
    addListener(
      callback: undefined extends ReturnType<H>
        ? (...args: Parameters<H>) => void
        : H
    ): void
    removeListener(
      callback: undefined extends ReturnType<H>
        ? (...args: Parameters<H>) => void
        : H
    ): void
    hasListener(
      callback: undefined extends ReturnType<H>
        ? (...args: Parameters<H>) => void
        : H
    ): boolean
  }
}

declare namespace browser.tabs {
  /**
   * What changed in a tab, the second argument of an `onUpdated` listener.
   */
  export type OnUpdatedInfo =
    typeof onUpdated extends events.Event<infer H> ? Parameters<H>[1] : never

  /**
   * The name older @types/chrome releases gave `OnUpdatedInfo`.
   */
  export type TabChangeInfo = OnUpdatedInfo
}

declare namespace chrome.tabs {
  export import OnUpdatedInfo = browser.tabs.OnUpdatedInfo
  export import TabChangeInfo = browser.tabs.TabChangeInfo
}
