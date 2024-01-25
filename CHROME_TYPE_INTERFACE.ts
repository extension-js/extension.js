interface Window {
  chrome: typeof chrome
}

declare namespace chrome.accessibilityFeatures {
  export var spokenFeedback: chrome.types.ChromeSetting
  export var largeCursor: chrome.types.ChromeSetting
  export var stickyKeys: chrome.types.ChromeSetting
  export var highContrast: chrome.types.ChromeSetting
  export var screenMagnifier: chrome.types.ChromeSetting
  export var autoclick: chrome.types.ChromeSetting
  export var virtualKeyboard: chrome.types.ChromeSetting
  export var caretHighlight: chrome.types.ChromeSetting
  export var cursorHighlight: chrome.types.ChromeSetting
  export var focusHighlight: chrome.types.ChromeSetting
  export var selectToSpeak: chrome.types.ChromeSetting
  export var switchAccess: chrome.types.ChromeSetting
  export var animationPolicy: chrome.types.ChromeSetting
}

declare namespace chrome.action {
  export interface BadgeBackgroundColorDetails extends BadgeColorDetails {}

  export interface BadgeColorDetails {
    color: string | ColorArray

    tabId?: number | undefined
  }

  export interface BadgeTextDetails {
    text: string

    tabId?: number | undefined
  }

  export type ColorArray = [number, number, number, number]

  export interface TitleDetails {
    title: string

    tabId?: number | undefined
  }

  export interface PopupDetails {
    tabId?: number | undefined

    popup: string
  }

  export interface BrowserClickedEvent
    extends chrome.events.Event<(tab: chrome.tabs.Tab) => void> {}

  export interface TabIconDetails {
    path?: string | {[index: number]: string} | undefined

    tabId?: number | undefined

    imageData?: ImageData | {[index: number]: ImageData} | undefined
  }

  export interface OpenPopupOptions {
    windowId?: number | undefined
  }

  export interface TabDetails {
    tabId?: number | undefined
  }

  export interface UserSettings {
    isOnToolbar: boolean
  }

  export function disable(tabId?: number): Promise<void>

  export function disable(callback: () => void): void
  export function disable(tabId: number, callback: () => void): void

  export function enable(tabId?: number): Promise<void>

  export function enable(callback: () => void): void
  export function enable(tabId: number, callback: () => void): void

  export function getBadgeBackgroundColor(
    details: TabDetails,
    callback: (result: ColorArray) => void
  ): void

  export function getBadgeBackgroundColor(
    details: TabDetails
  ): Promise<ColorArray>

  export function getBadgeText(
    details: TabDetails,
    callback: (result: string) => void
  ): void

  export function getBadgeText(details: TabDetails): Promise<string>

  export function getBadgeTextColor(
    details: TabDetails,
    callback: (result: ColorArray) => void
  ): void

  export function getBadgeTextColor(details: TabDetails): Promise<ColorArray>

  export function getPopup(
    details: TabDetails,
    callback: (result: string) => void
  ): void

  export function getPopup(details: TabDetails): Promise<string>

  export function getTitle(
    details: TabDetails,
    callback: (result: string) => void
  ): void

  export function getTitle(details: TabDetails): Promise<string>

  export function getUserSettings(
    callback: (userSettings: UserSettings) => void
  ): void

  export function getUserSettings(): Promise<UserSettings>

  export function isEnabled(
    tabId: number | undefined,
    callback: (isEnabled: boolean) => void
  ): void

  export function isEnabled(tabId?: number): Promise<boolean>

  export function openPopup(options?: OpenPopupOptions): Promise<void>

  export function openPopup(callback: () => void): void
  export function openPopup(
    options: OpenPopupOptions,
    callback: () => void
  ): void

  export function setBadgeBackgroundColor(
    details: BadgeColorDetails
  ): Promise<void>

  export function setBadgeBackgroundColor(
    details: BadgeColorDetails,
    callback: () => void
  ): void

  export function setBadgeText(details: BadgeTextDetails): Promise<void>

  export function setBadgeText(
    details: BadgeTextDetails,
    callback: () => void
  ): void

  export function setBadgeTextColor(details: BadgeColorDetails): Promise<void>

  export function setBadgeTextColor(
    details: BadgeColorDetails,
    callback: () => void
  ): void

  export function setIcon(details: TabIconDetails): Promise<void>
  export function setIcon(details: TabIconDetails, callback: () => void): void

  export function setPopup(details: PopupDetails): Promise<void>

  export function setPopup(details: PopupDetails, callback: () => void): void

  export function setTitle(details: TitleDetails): Promise<void>

  export function setTitle(details: TitleDetails, callback: () => void): void

  export var onClicked: BrowserClickedEvent
}

declare namespace chrome.alarms {
  export interface AlarmCreateInfo {
    delayInMinutes?: number | undefined

    periodInMinutes?: number | undefined

    when?: number | undefined
  }

  export interface Alarm {
    periodInMinutes?: number | undefined

    scheduledTime: number

    name: string
  }

  export interface AlarmEvent
    extends chrome.events.Event<(alarm: Alarm) => void> {}

  export function create(alarmInfo: AlarmCreateInfo): Promise<void>

  export function create(
    name: string,
    alarmInfo: AlarmCreateInfo
  ): Promise<void>

  export function create(alarmInfo: AlarmCreateInfo, callback: () => void): void

  export function create(
    name: string,
    alarmInfo: AlarmCreateInfo,
    callback: () => void
  ): void

  export function getAll(callback: (alarms: Alarm[]) => void): void

  export function getAll(): Promise<Alarm[]>

  export function clearAll(): Promise<boolean>

  export function clearAll(callback: (wasCleared: boolean) => void): void

  export function clear(name?: string): Promise<boolean>

  export function clear(callback: (wasCleared: boolean) => void): void
  export function clear(
    name: string,
    callback: (wasCleared: boolean) => void
  ): void

  export function clear(callback: (wasCleared: boolean) => void): void

  export function clear(): Promise<void>

  export function get(callback: (alarm: Alarm) => void): void

  export function get(): Promise<Alarm>

  export function get(name: string, callback: (alarm: Alarm) => void): void

  export function get(name: string): Promise<Alarm>

  export var onAlarm: AlarmEvent
}

declare namespace chrome.browser {
  export interface Options {
    url: string
  }

  export function openTab(options: Options, callback: () => void): void

  export function openTab(options: Options): void
}

declare namespace chrome.bookmarks {
  export interface BookmarkTreeNode {
    index?: number | undefined

    dateAdded?: number | undefined

    title: string

    url?: string | undefined

    dateGroupModified?: number | undefined

    id: string

    parentId?: string | undefined

    children?: BookmarkTreeNode[] | undefined

    unmodifiable?: 'managed' | undefined
  }

  export interface BookmarkRemoveInfo {
    index: number
    parentId: string
    node: BookmarkTreeNode
  }

  export interface BookmarkMoveInfo {
    index: number
    oldIndex: number
    parentId: string
    oldParentId: string
  }

  export interface BookmarkChangeInfo {
    url?: string | undefined
    title: string
  }

  export interface BookmarkReorderInfo {
    childIds: string[]
  }

  export interface BookmarkRemovedEvent
    extends chrome.events.Event<
      (id: string, removeInfo: BookmarkRemoveInfo) => void
    > {}

  export interface BookmarkImportEndedEvent
    extends chrome.events.Event<() => void> {}

  export interface BookmarkMovedEvent
    extends chrome.events.Event<
      (id: string, moveInfo: BookmarkMoveInfo) => void
    > {}

  export interface BookmarkImportBeganEvent
    extends chrome.events.Event<() => void> {}

  export interface BookmarkChangedEvent
    extends chrome.events.Event<
      (id: string, changeInfo: BookmarkChangeInfo) => void
    > {}

  export interface BookmarkCreatedEvent
    extends chrome.events.Event<
      (id: string, bookmark: BookmarkTreeNode) => void
    > {}

  export interface BookmarkChildrenReordered
    extends chrome.events.Event<
      (id: string, reorderInfo: BookmarkReorderInfo) => void
    > {}

  export interface BookmarkSearchQuery {
    query?: string | undefined
    url?: string | undefined
    title?: string | undefined
  }

  export interface BookmarkCreateArg {
    parentId?: string | undefined
    index?: number | undefined
    title?: string | undefined
    url?: string | undefined
  }

  export interface BookmarkDestinationArg {
    parentId?: string | undefined
    index?: number | undefined
  }

  export interface BookmarkChangesArg {
    title?: string | undefined
    url?: string | undefined
  }

  export var MAX_WRITE_OPERATIONS_PER_HOUR: number

  export var MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE: number

  export function search(
    query: string,
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function search(query: string): Promise<BookmarkTreeNode[]>

  export function search(
    query: BookmarkSearchQuery,
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function search(
    query: BookmarkSearchQuery
  ): Promise<BookmarkTreeNode[]>

  export function getTree(callback: (results: BookmarkTreeNode[]) => void): void

  export function getTree(): Promise<BookmarkTreeNode[]>

  export function getRecent(
    numberOfItems: number,
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function getRecent(numberOfItems: number): Promise<BookmarkTreeNode[]>

  export function get(
    id: string,
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function get(id: string): Promise<BookmarkTreeNode[]>

  export function get(
    idList: string[],
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function get(idList: string[]): Promise<BookmarkTreeNode[]>

  export function create(bookmark: BookmarkCreateArg): Promise<BookmarkTreeNode>

  export function create(
    bookmark: BookmarkCreateArg,
    callback: (result: BookmarkTreeNode) => void
  ): void

  export function move(
    id: string,
    destination: BookmarkDestinationArg
  ): Promise<BookmarkTreeNode>

  export function move(
    id: string,
    destination: BookmarkDestinationArg,
    callback: (result: BookmarkTreeNode) => void
  ): void

  export function update(
    id: string,
    changes: BookmarkChangesArg
  ): Promise<BookmarkTreeNode>

  export function update(
    id: string,
    changes: BookmarkChangesArg,
    callback: (result: BookmarkTreeNode) => void
  ): void

  export function remove(id: string): Promise<void>

  export function remove(id: string, callback: Function): void

  export function getChildren(
    id: string,
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function getChildren(id: string): Promise<BookmarkTreeNode[]>

  export function getSubTree(
    id: string,
    callback: (results: BookmarkTreeNode[]) => void
  ): void

  export function getSubTree(id: string): Promise<BookmarkTreeNode[]>

  export function removeTree(id: string): Promise<void>

  export function removeTree(id: string, callback: Function): void

  export var onRemoved: BookmarkRemovedEvent

  export var onImportEnded: BookmarkImportEndedEvent

  export var onImportBegan: BookmarkImportBeganEvent

  export var onChanged: BookmarkChangedEvent

  export var onMoved: BookmarkMovedEvent

  export var onCreated: BookmarkCreatedEvent

  export var onChildrenReordered: BookmarkChildrenReordered
}

declare namespace chrome.browserAction {
  export interface BadgeBackgroundColorDetails {
    color: string | ColorArray

    tabId?: number | undefined
  }

  export interface BadgeTextDetails {
    text?: string | null | undefined

    tabId?: number | undefined
  }

  export type ColorArray = [number, number, number, number]

  export interface TitleDetails {
    title: string

    tabId?: number | null
  }

  export interface TabDetails {
    tabId?: number | null
  }

  export interface TabIconDetails {
    path?: string | {[index: string]: string} | undefined

    tabId?: number | undefined

    imageData?: ImageData | {[index: number]: ImageData} | undefined
  }

  export interface PopupDetails {
    tabId?: number | null

    popup: string
  }

  export interface BrowserClickedEvent
    extends chrome.events.Event<(tab: chrome.tabs.Tab) => void> {}

  export function enable(tabId?: number | null): Promise<void>

  export function enable(callback?: () => void): void
  export function enable(
    tabId: number | null | undefined,
    callback?: () => void
  ): void

  export function setBadgeBackgroundColor(
    details: BadgeBackgroundColorDetails
  ): Promise<void>

  export function setBadgeBackgroundColor(
    details: BadgeBackgroundColorDetails,
    callback?: () => void
  ): void

  export function setBadgeText(details: BadgeTextDetails): Promise<void>

  export function setBadgeText(
    details: BadgeTextDetails,
    callback: () => void
  ): void

  export function setTitle(details: TitleDetails): Promise<void>

  export function setTitle(details: TitleDetails, callback: () => void): void

  export function getBadgeText(
    details: TabDetails,
    callback: (result: string) => void
  ): void

  export function getBadgeText(details: TabDetails): Promise<string>

  export function setPopup(details: PopupDetails): Promise<void>

  export function setPopup(details: PopupDetails, callback?: () => void): void

  export function disable(tabId?: number | null): Promise<void>

  export function disable(callback: () => void): void
  export function disable(tabId?: number | null, callback?: () => void): void

  export function getTitle(
    details: TabDetails,
    callback: (result: string) => void
  ): void

  export function getTitle(details: TabDetails): Promise<string>

  export function getBadgeBackgroundColor(
    details: TabDetails,
    callback: (result: ColorArray) => void
  ): void

  export function getBadgeBackgroundColor(
    details: TabDetails
  ): Promise<ColorArray>

  export function getPopup(
    details: TabDetails,
    callback: (result: string) => void
  ): void

  export function getPopup(details: TabDetails): Promise<string>

  export function setIcon(details: TabIconDetails, callback?: Function): void

  export var onClicked: BrowserClickedEvent
}

declare namespace chrome.browsingData {
  export interface OriginTypes {
    extension?: boolean | undefined

    protectedWeb?: boolean | undefined

    unprotectedWeb?: boolean | undefined
  }

  export interface RemovalOptions {
    excludeOrigins?: string[] | undefined

    originTypes?: OriginTypes | undefined

    origins?: string[] | undefined

    since?: number | undefined
  }

  export interface DataTypeSet {
    webSQL?: boolean | undefined

    indexedDB?: boolean | undefined

    cookies?: boolean | undefined

    passwords?: boolean | undefined

    serverBoundCertificates?: boolean | undefined

    downloads?: boolean | undefined

    cache?: boolean | undefined

    cacheStorage?: boolean | undefined

    appcache?: boolean | undefined

    fileSystems?: boolean | undefined

    pluginData?: boolean | undefined

    localStorage?: boolean | undefined

    formData?: boolean | undefined

    history?: boolean | undefined

    serviceWorkers?: boolean | undefined
  }

  export interface SettingsResult {
    options: RemovalOptions

    dataToRemove: DataTypeSet

    dataRemovalPermitted: DataTypeSet
  }

  export function settings(): Promise<SettingsResult>

  export function settings(callback: (result: SettingsResult) => void): void

  export function removePluginData(options: RemovalOptions): Promise<void>

  export function removePluginData(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeServiceWorkers(options: RemovalOptions): Promise<void>

  export function removeServiceWorkers(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeFormData(options: RemovalOptions): Promise<void>

  export function removeFormData(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeFileSystems(options: RemovalOptions): Promise<void>

  export function removeFileSystems(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function remove(
    options: RemovalOptions,
    dataToRemove: DataTypeSet
  ): Promise<void>

  export function remove(
    options: RemovalOptions,
    dataToRemove: DataTypeSet,
    callback: () => void
  ): void

  export function removePasswords(options: RemovalOptions): Promise<void>

  export function removePasswords(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeCookies(options: RemovalOptions): Promise<void>

  export function removeCookies(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeWebSQL(options: RemovalOptions): Promise<void>

  export function removeWebSQL(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeAppcache(options: RemovalOptions): Promise<void>

  export function removeAppcache(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeCacheStorage(options: RemovalOptions): Promise<void>

  export function removeCacheStorage(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeDownloads(options: RemovalOptions): Promise<void>

  export function removeDownloads(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeLocalStorage(options: RemovalOptions): Promise<void>

  export function removeLocalStorage(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeCache(options: RemovalOptions): Promise<void>

  export function removeCache(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeHistory(options: RemovalOptions): Promise<void>

  export function removeHistory(
    options: RemovalOptions,
    callback: () => void
  ): void

  export function removeIndexedDB(options: RemovalOptions): Promise<void>

  export function removeIndexedDB(
    options: RemovalOptions,
    callback: () => void
  ): void
}

declare namespace chrome.commands {
  export interface Command {
    name?: string | undefined

    description?: string | undefined

    shortcut?: string | undefined
  }

  export interface CommandEvent
    extends chrome.events.Event<
      (command: string, tab: chrome.tabs.Tab) => void
    > {}

  export function getAll(): Promise<Command[]>

  export function getAll(callback: (commands: Command[]) => void): void

  export var onCommand: CommandEvent
}

declare namespace chrome.contentSettings {
  type ScopeEnum = 'regular' | 'incognito_session_only'

  export interface ClearDetails {
    scope?: ScopeEnum | undefined
  }

  type DefaultContentSettingDetails =
    | 'allow'
    | 'ask'
    | 'block'
    | 'detect_important_content'
    | 'session_only'

  export interface SetDetails {
    resourceIdentifier?: ResourceIdentifier | undefined

    setting: DefaultContentSettingDetails

    secondaryPattern?: string | undefined

    scope?: ScopeEnum | undefined

    primaryPattern: string
  }

  export interface CookieSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'session_only'
  }

  export interface ImagesSetDetails extends SetDetails {
    setting: 'allow' | 'block'
  }

  export interface JavascriptSetDetails extends SetDetails {
    setting: 'allow' | 'block'
  }

  export interface LocationSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'ask'
  }

  export interface PluginsSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'detect_important_content'
  }

  export interface PopupsSetDetails extends SetDetails {
    setting: 'allow' | 'block'
  }

  export interface NotificationsSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'ask'
  }

  export interface FullscreenSetDetails extends SetDetails {
    setting: 'allow'
  }

  export interface MouselockSetDetails extends SetDetails {
    setting: 'allow'
  }

  export interface MicrophoneSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'ask'
  }

  export interface CameraSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'ask'
  }

  export interface PpapiBrokerSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'ask'
  }

  export interface MultipleAutomaticDownloadsSetDetails extends SetDetails {
    setting: 'allow' | 'block' | 'ask'
  }

  export interface GetDetails {
    secondaryUrl?: string | undefined

    resourceIdentifier?: ResourceIdentifier | undefined

    incognito?: boolean | undefined

    primaryUrl: string
  }

  export interface ReturnedDetails {
    setting: DefaultContentSettingDetails
  }

  export interface ContentSetting {
    clear(details: ClearDetails, callback?: () => void): void

    set(details: SetDetails, callback?: () => void): void
    getResourceIdentifiers(
      callback: (resourceIdentifiers?: ResourceIdentifier[]) => void
    ): void

    get(details: GetDetails, callback: (details: ReturnedDetails) => void): void
  }

  export interface CookieContentSetting extends ContentSetting {
    set(details: CookieSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: CookieSetDetails) => void
    ): void
  }

  export interface PopupsContentSetting extends ContentSetting {
    set(details: PopupsSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: PopupsSetDetails) => void
    ): void
  }

  export interface JavascriptContentSetting extends ContentSetting {
    set(details: JavascriptSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: JavascriptSetDetails) => void
    ): void
  }

  export interface NotificationsContentSetting extends ContentSetting {
    set(details: NotificationsSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: NotificationsSetDetails) => void
    ): void
  }

  export interface PluginsContentSetting extends ContentSetting {
    set(details: PluginsSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: PluginsSetDetails) => void
    ): void
  }

  export interface ImagesContentSetting extends ContentSetting {
    set(details: ImagesSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: ImagesSetDetails) => void
    ): void
  }

  export interface LocationContentSetting extends ContentSetting {
    set(details: LocationSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: LocationSetDetails) => void
    ): void
  }

  export interface FullscreenContentSetting extends ContentSetting {
    set(details: FullscreenSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: FullscreenSetDetails) => void
    ): void
  }

  export interface MouselockContentSetting extends ContentSetting {
    set(details: MouselockSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: MouselockSetDetails) => void
    ): void
  }

  export interface MicrophoneContentSetting extends ContentSetting {
    set(details: MicrophoneSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: MicrophoneSetDetails) => void
    ): void
  }

  export interface CameraContentSetting extends ContentSetting {
    set(details: CameraSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: CameraSetDetails) => void
    ): void
  }

  export interface PpapiBrokerContentSetting extends ContentSetting {
    set(details: PpapiBrokerSetDetails, callback?: () => void): void
    get(
      details: GetDetails,
      callback: (details: PpapiBrokerSetDetails) => void
    ): void
  }

  export interface MultipleAutomaticDownloadsContentSetting
    extends ContentSetting {
    set(
      details: MultipleAutomaticDownloadsSetDetails,
      callback?: () => void
    ): void
    get(
      details: GetDetails,
      callback: (details: MultipleAutomaticDownloadsSetDetails) => void
    ): void
  }

  export interface ResourceIdentifier {
    id: string

    description?: string | undefined
  }

  export var cookies: CookieContentSetting

  export var popups: PopupsContentSetting

  export var javascript: JavascriptContentSetting

  export var notifications: NotificationsContentSetting

  export var plugins: PluginsContentSetting

  export var images: ImagesContentSetting

  export var location: LocationContentSetting

  export var fullscreen: FullscreenContentSetting

  export var mouselock: MouselockContentSetting

  export var microphone: MicrophoneContentSetting

  export var camera: CameraContentSetting

  export var unsandboxedPlugins: PpapiBrokerContentSetting

  export var automaticDownloads: MultipleAutomaticDownloadsContentSetting
}

declare namespace chrome.contextMenus {
  export interface OnClickData {
    selectionText?: string | undefined

    checked?: boolean | undefined

    menuItemId: number | string

    frameId?: number | undefined

    frameUrl?: string | undefined

    editable: boolean

    mediaType?: 'image' | 'video' | 'audio' | undefined

    wasChecked?: boolean | undefined

    pageUrl: string

    linkUrl?: string | undefined

    parentMenuItemId?: number | string

    srcUrl?: string | undefined
  }

  type ContextType =
    | 'all'
    | 'page'
    | 'frame'
    | 'selection'
    | 'link'
    | 'editable'
    | 'image'
    | 'video'
    | 'audio'
    | 'launcher'
    | 'browser_action'
    | 'page_action'
    | 'action'

  type ContextItemType = 'normal' | 'checkbox' | 'radio' | 'separator'

  export interface CreateProperties {
    documentUrlPatterns?: string[] | undefined

    checked?: boolean | undefined

    title?: string | undefined

    contexts?: ContextType | ContextType[] | undefined

    enabled?: boolean | undefined

    targetUrlPatterns?: string[] | undefined

    onclick?: ((info: OnClickData, tab: chrome.tabs.Tab) => void) | undefined

    parentId?: number | string | undefined

    type?: ContextItemType | undefined

    id?: string | undefined

    visible?: boolean | undefined
  }

  export interface UpdateProperties {
    documentUrlPatterns?: string[] | undefined
    checked?: boolean | undefined
    title?: string | undefined
    contexts?: ContextType[] | undefined

    enabled?: boolean | undefined
    targetUrlPatterns?: string[] | undefined
    onclick?: Function | undefined

    parentId?: number | string
    type?: ContextItemType | undefined

    visible?: boolean | undefined
  }

  export interface MenuClickedEvent
    extends chrome.events.Event<
      (info: OnClickData, tab?: chrome.tabs.Tab) => void
    > {}

  export var ACTION_MENU_TOP_LEVEL_LIMIT: number

  export function removeAll(callback?: () => void): void

  export function create(
    createProperties: CreateProperties,
    callback?: () => void
  ): number | string

  export function update(
    id: string | number,
    updateProperties: UpdateProperties,
    callback?: () => void
  ): void

  export function remove(
    menuItemId: string | number,
    callback?: () => void
  ): void

  export var onClicked: MenuClickedEvent
}

declare namespace chrome.cookies {
  export type SameSiteStatus =
    | 'unspecified'
    | 'no_restriction'
    | 'lax'
    | 'strict'

  export interface Cookie {
    domain: string

    name: string

    storeId: string

    value: string

    session: boolean

    hostOnly: boolean

    expirationDate?: number | undefined

    path: string

    httpOnly: boolean

    secure: boolean

    sameSite: SameSiteStatus
  }

  export interface CookieStore {
    id: string

    tabIds: number[]
  }

  export interface GetAllDetails {
    domain?: string | undefined

    name?: string | undefined

    url?: string | undefined

    storeId?: string | undefined

    session?: boolean | undefined

    path?: string | undefined

    secure?: boolean | undefined
  }

  export interface SetDetails {
    domain?: string | undefined

    name?: string | undefined

    url: string

    storeId?: string | undefined

    value?: string | undefined

    expirationDate?: number | undefined

    path?: string | undefined

    httpOnly?: boolean | undefined

    secure?: boolean | undefined

    sameSite?: SameSiteStatus | undefined
  }

  export interface Details {
    name: string
    url: string
    storeId?: string | undefined
  }

  export interface CookieChangeInfo {
    cookie: Cookie

    removed: boolean

    cause: string
  }

  export interface CookieChangedEvent
    extends chrome.events.Event<(changeInfo: CookieChangeInfo) => void> {}

  export function getAllCookieStores(
    callback: (cookieStores: CookieStore[]) => void
  ): void

  export function getAllCookieStores(): Promise<CookieStore[]>

  export function getAll(
    details: GetAllDetails,
    callback: (cookies: Cookie[]) => void
  ): void

  export function getAll(details: GetAllDetails): Promise<Cookie[]>

  export function set(details: SetDetails): Promise<Cookie | null>

  export function set(
    details: SetDetails,
    callback: (cookie: Cookie | null) => void
  ): void

  export function remove(details: Details): Promise<Details>

  export function remove(
    details: Details,
    callback?: (details: Details) => void
  ): void

  export function get(
    details: Details,
    callback: (cookie: Cookie | null) => void
  ): void

  export function get(details: Details): Promise<Cookie | null>

  export var onChanged: CookieChangedEvent
}

declare namespace chrome {
  namespace _debugger {
    export interface Debuggee {
      tabId?: number | undefined

      extensionId?: string | undefined

      targetId?: string | undefined
    }

    export interface TargetInfo {
      type: string

      id: string

      tabId?: number | undefined

      extensionId?: string | undefined

      attached: boolean

      title: string

      url: string

      faviconUrl?: string | undefined
    }

    export interface DebuggerDetachedEvent
      extends chrome.events.Event<(source: Debuggee, reason: string) => void> {}

    export interface DebuggerEventEvent
      extends chrome.events.Event<
        (source: Debuggee, method: string, params?: Object) => void
      > {}

    export function attach(
      target: Debuggee,
      requiredVersion: string
    ): Promise<void>

    export function attach(
      target: Debuggee,
      requiredVersion: string,
      callback: () => void
    ): void

    export function detach(target: Debuggee): Promise<void>

    export function detach(target: Debuggee, callback: () => void): void

    export function sendCommand(
      target: Debuggee,
      method: string,
      commandParams?: Object
    ): Promise<Object>

    export function sendCommand(
      target: Debuggee,
      method: string,
      commandParams?: Object,
      callback?: (result?: Object) => void
    ): void

    export function getTargets(): Promise<TargetInfo[]>

    export function getTargets(callback: (result: TargetInfo[]) => void): void

    export var onDetach: DebuggerDetachedEvent

    export var onEvent: DebuggerEventEvent
  }

  export {_debugger as debugger}
}

declare namespace chrome.declarativeContent {
  export interface PageStateUrlDetails {
    hostContains?: string | undefined

    hostEquals?: string | undefined

    hostPrefix?: string | undefined

    hostSuffix?: string | undefined

    pathContains?: string | undefined

    pathEquals?: string | undefined

    pathPrefix?: string | undefined

    pathSuffix?: string | undefined

    queryContains?: string | undefined

    queryEquals?: string | undefined

    queryPrefix?: string | undefined

    querySuffix?: string | undefined

    urlContains?: string | undefined

    urlEquals?: string | undefined

    urlMatches?: string | undefined

    originAndPathMatches?: string | undefined

    urlPrefix?: string | undefined

    urlSuffix?: string | undefined

    schemes?: string[] | undefined

    ports?: Array<number | number[]> | undefined
  }

  export class PageStateMatcherProperties {
    pageUrl?: PageStateUrlDetails | undefined

    css?: string[] | undefined

    isBookmarked?: boolean | undefined
  }

  export class PageStateMatcher {
    constructor(options: PageStateMatcherProperties)
  }

  export class ShowAction {}

  export class ShowPageAction {}

  export class SetIcon {
    constructor(options?: {
      imageData?: ImageData | {[size: string]: ImageData} | undefined
    })
  }

  export interface PageChangedEvent extends chrome.events.Event<() => void> {}

  export var onPageChanged: PageChangedEvent
}

declare namespace chrome.declarativeWebRequest {
  export interface HeaderFilter {
    nameEquals?: string | undefined
    valueContains?: string | string[] | undefined
    nameSuffix?: string | undefined
    valueSuffix?: string | undefined
    valuePrefix?: string | undefined
    nameContains?: string | string[] | undefined
    valueEquals?: string | undefined
    namePrefix?: string | undefined
  }

  export interface AddResponseHeader {
    name: string
    value: string
  }

  export interface RemoveResponseCookie {
    filter: ResponseCookie
  }

  export interface RemoveResponseHeader {
    name: string
    value?: string | undefined
  }

  export interface RequestMatcher {
    contentType?: string[] | undefined
    url?: chrome.events.UrlFilter | undefined
    excludeContentType?: string[] | undefined
    excludeResponseHeader?: HeaderFilter[] | undefined
    resourceType?: string | undefined
    responseHeaders?: HeaderFilter[] | undefined
  }

  export interface IgnoreRules {
    lowerPriorityThan: number
  }

  export interface RedirectToEmptyDocument {}

  export interface RedirectRequest {
    redirectUrl: string
  }

  export interface ResponseCookie {
    domain?: string | undefined
    name?: string | undefined
    expires?: string | undefined
    maxAge?: number | undefined
    value?: string | undefined
    path?: string | undefined
    httpOnly?: string | undefined
    secure?: string | undefined
  }

  export interface AddResponseCookie {
    cookie: ResponseCookie
  }

  export interface EditResponseCookie {
    filter: ResponseCookie
    modification: ResponseCookie
  }

  export interface CancelRequest {}

  export interface RemoveRequestHeader {
    name: string
  }

  export interface EditRequestCookie {
    filter: RequestCookie
    modification: RequestCookie
  }

  export interface SetRequestHeader {
    name: string
    value: string
  }

  export interface RequestCookie {
    name?: string | undefined
    value?: string | undefined
  }

  export interface RedirectByRegEx {
    to: string
    from: string
  }

  export interface RedirectToTransparentImage {}

  export interface AddRequestCookie {
    cookie: RequestCookie
  }

  export interface RemoveRequestCookie {
    filter: RequestCookie
  }

  export interface RequestedEvent extends chrome.events.Event<Function> {}

  export var onRequest: RequestedEvent
}

declare namespace chrome.desktopCapture {
  export interface StreamOptions {
    canRequestAudioTrack: boolean
  }

  export function chooseDesktopMedia(
    sources: string[],
    callback: (streamId: string, options: StreamOptions) => void
  ): number

  export function chooseDesktopMedia(
    sources: string[],
    targetTab: chrome.tabs.Tab,
    callback: (streamId: string, options: StreamOptions) => void
  ): number

  export function cancelChooseDesktopMedia(desktopMediaRequestId: number): void
}

declare namespace chrome.devtools.inspectedWindow {
  export interface Resource {
    url: string

    getContent(
      callback: (
        content: string,

        encoding: string
      ) => void
    ): void

    setContent(
      content: string,
      commit: boolean,
      callback?: (error?: Object) => void
    ): void
  }

  export interface ReloadOptions {
    userAgent?: string | undefined

    ignoreCache?: boolean | undefined

    injectedScript?: string | undefined

    preprocessorScript?: string | undefined
  }

  export interface EvaluationExceptionInfo {
    isError: boolean

    code: string

    description: string

    details: any[]

    isException: boolean

    value: string
  }

  export interface ResourceAddedEvent
    extends chrome.events.Event<(resource: Resource) => void> {}

  export interface ResourceContentCommittedEvent
    extends chrome.events.Event<
      (resource: Resource, content: string) => void
    > {}

  export var tabId: number

  export function reload(reloadOptions?: ReloadOptions): void

  export function eval<T>(
    expression: string,
    callback?: (result: T, exceptionInfo: EvaluationExceptionInfo) => void
  ): void

  export function eval<T>(
    expression: string,
    options?: EvalOptions,
    callback?: (result: T, exceptionInfo: EvaluationExceptionInfo) => void
  ): void

  export function getResources(callback: (resources: Resource[]) => void): void

  export var onResourceAdded: ResourceAddedEvent

  export var onResourceContentCommitted: ResourceContentCommittedEvent

  export interface EvalOptions {
    frameURL?: string | undefined

    useContentScriptContext?: boolean | undefined

    contextSecurityOrigin?: string | undefined
  }
}

declare namespace chrome.devtools.network {
  export interface HAREntry extends HARFormatEntry {}

  export interface HARLog extends HARFormatLog {}

  export interface Request extends chrome.devtools.network.HAREntry {
    getContent(
      callback: (
        content: string,

        encoding: string
      ) => void
    ): void
  }

  export interface RequestFinishedEvent
    extends chrome.events.Event<(request: Request) => void> {}

  export interface NavigatedEvent
    extends chrome.events.Event<(url: string) => void> {}

  export function getHAR(callback: (harLog: HARLog) => void): void

  export var onRequestFinished: RequestFinishedEvent

  export var onNavigated: NavigatedEvent
}

declare namespace chrome.devtools.panels {
  export interface PanelShownEvent
    extends chrome.events.Event<(window: Window) => void> {}

  export interface PanelHiddenEvent extends chrome.events.Event<() => void> {}

  export interface PanelSearchEvent
    extends chrome.events.Event<
      (action: string, queryString?: string) => void
    > {}

  export interface ExtensionPanel {
    createStatusBarButton(
      iconPath: string,
      tooltipText: string,
      disabled: boolean
    ): Button

    onShown: PanelShownEvent

    onHidden: PanelHiddenEvent

    onSearch: PanelSearchEvent
  }

  export interface ButtonClickedEvent extends chrome.events.Event<() => void> {}

  export interface Button {
    update(
      iconPath?: string | null,
      tooltipText?: string | null,
      disabled?: boolean | null
    ): void

    onClicked: ButtonClickedEvent
  }

  export interface SelectionChangedEvent
    extends chrome.events.Event<() => void> {}

  export interface ElementsPanel {
    createSidebarPane(
      title: string,
      callback?: (result: ExtensionSidebarPane) => void
    ): void

    onSelectionChanged: SelectionChangedEvent
  }

  export interface SourcesPanel {
    createSidebarPane(
      title: string,
      callback?: (result: ExtensionSidebarPane) => void
    ): void

    onSelectionChanged: SelectionChangedEvent
  }

  export interface ExtensionSidebarPaneShownEvent
    extends chrome.events.Event<(window: chrome.windows.Window) => void> {}

  export interface ExtensionSidebarPaneHiddenEvent
    extends chrome.events.Event<() => void> {}

  export interface ExtensionSidebarPane {
    setHeight(height: string): void

    setExpression(
      expression: string,
      rootTitle?: string,
      callback?: () => void
    ): void

    setExpression(expression: string, callback?: () => void): void

    setObject(
      jsonObject: Object,
      rootTitle?: string,
      callback?: () => void
    ): void

    setObject(jsonObject: Object, callback?: () => void): void

    setPage(path: string): void

    onShown: ExtensionSidebarPaneShownEvent

    onHidden: ExtensionSidebarPaneHiddenEvent
  }

  export var elements: ElementsPanel

  export var sources: SourcesPanel

  export function create(
    title: string,
    iconPath: string,
    pagePath: string,
    callback?: (panel: ExtensionPanel) => void
  ): void

  export function setOpenResourceHandler(
    callback?: (resource: chrome.devtools.inspectedWindow.Resource) => void
  ): void

  export function openResource(
    url: string,
    lineNumber: number,
    callback?: () => void
  ): void

  export function openResource(
    url: string,
    lineNumber: number,
    columnNumber: number,
    callback?: (response: unknown) => unknown
  ): void

  export var themeName: 'default' | 'dark'
}

declare namespace chrome.documentScan {
  export interface DocumentScanOptions {
    mimeTypes?: string[] | undefined

    maxImages?: number | undefined
  }

  export interface DocumentScanCallbackArg {
    dataUrls: string[]

    mimeType: string
  }

  export function scan(
    options: DocumentScanOptions,
    callback: (result: DocumentScanCallbackArg) => void
  ): void
}

declare namespace chrome.dom {
  export function openOrClosedShadowRoot(element: HTMLElement): ShadowRoot
}

declare namespace chrome.downloads {
  export interface HeaderNameValuePair {
    name: string

    value: string
  }

  export type FilenameConflictAction = 'uniquify' | 'overwrite' | 'prompt'

  export interface DownloadOptions {
    body?: string | undefined

    saveAs?: boolean | undefined

    url: string

    filename?: string | undefined

    headers?: HeaderNameValuePair[] | undefined

    method?: 'GET' | 'POST' | undefined

    conflictAction?: FilenameConflictAction | undefined
  }

  export interface DownloadDelta {
    id: number

    danger?: StringDelta | undefined

    url?: StringDelta | undefined

    finalUrl?: StringDelta | undefined

    totalBytes?: DoubleDelta | undefined

    filename?: StringDelta | undefined

    paused?: BooleanDelta | undefined

    state?: StringDelta | undefined

    mime?: StringDelta | undefined

    fileSize?: DoubleDelta | undefined

    startTime?: StringDelta | undefined

    error?: StringDelta | undefined

    endTime?: StringDelta | undefined

    canResume?: BooleanDelta | undefined

    exists?: BooleanDelta | undefined
  }

  export interface BooleanDelta {
    current?: boolean | undefined
    previous?: boolean | undefined
  }

  export interface DoubleDelta {
    current?: number | undefined
    previous?: number | undefined
  }

  export interface StringDelta {
    current?: string | undefined
    previous?: string | undefined
  }

  export type DownloadInterruptReason =
    | 'FILE_FAILED'
    | 'FILE_ACCESS_DENIED'
    | 'FILE_NO_SPACE'
    | 'FILE_NAME_TOO_LONG'
    | 'FILE_TOO_LARGE'
    | 'FILE_VIRUS_INFECTED'
    | 'FILE_TRANSIENT_ERROR'
    | 'FILE_BLOCKED'
    | 'FILE_SECURITY_CHECK_FAILED'
    | 'FILE_TOO_SHORT'
    | 'FILE_HASH_MISMATCH'
    | 'FILE_SAME_AS_SOURCE'
    | 'NETWORK_FAILED'
    | 'NETWORK_TIMEOUT'
    | 'NETWORK_DISCONNECTED'
    | 'NETWORK_SERVER_DOWN'
    | 'NETWORK_INVALID_REQUEST'
    | 'SERVER_FAILED'
    | 'SERVER_NO_RANGE'
    | 'SERVER_BAD_CONTENT'
    | 'SERVER_UNAUTHORIZED'
    | 'SERVER_CERT_PROBLEM'
    | 'SERVER_FORBIDDEN'
    | 'SERVER_UNREACHABLE'
    | 'SERVER_CONTENT_LENGTH_MISMATCH'
    | 'SERVER_CROSS_ORIGIN_REDIRECT'
    | 'USER_CANCELED'
    | 'USER_SHUTDOWN'
    | 'CRASH'

  export type DownloadState = 'in_progress' | 'interrupted' | 'complete'

  export type DangerType =
    | 'file'
    | 'url'
    | 'content'
    | 'uncommon'
    | 'host'
    | 'unwanted'
    | 'safe'
    | 'accepted'

  export interface DownloadItem {
    bytesReceived: number

    danger: DangerType

    url: string

    finalUrl: string

    totalBytes: number

    filename: string

    paused: boolean

    state: DownloadState

    mime: string

    fileSize: number

    startTime: string

    error?: DownloadInterruptReason | undefined

    endTime?: string | undefined

    id: number

    incognito: boolean

    referrer: string

    estimatedEndTime?: string | undefined

    canResume: boolean

    exists: boolean

    byExtensionId?: string | undefined

    byExtensionName?: string | undefined
  }

  export interface GetFileIconOptions {
    size?: 16 | 32 | undefined
  }

  export interface DownloadQuery {
    orderBy?: string[] | undefined

    urlRegex?: string | undefined

    endedBefore?: string | undefined

    totalBytesGreater?: number | undefined

    danger?: string | undefined

    totalBytes?: number | undefined

    paused?: boolean | undefined

    filenameRegex?: string | undefined

    query?: string[] | undefined

    totalBytesLess?: number | undefined

    id?: number | undefined

    bytesReceived?: number | undefined

    endedAfter?: string | undefined

    filename?: string | undefined

    state?: string | undefined

    startedAfter?: string | undefined

    mime?: string | undefined

    fileSize?: number | undefined

    startTime?: string | undefined

    url?: string | undefined

    startedBefore?: string | undefined

    limit?: number | undefined

    error?: number | undefined

    endTime?: string | undefined

    exists?: boolean | undefined
  }

  export interface DownloadFilenameSuggestion {
    filename: string

    conflictAction?: string | undefined
  }

  export interface UiOptions {
    enabled: boolean
  }

  export interface DownloadChangedEvent
    extends chrome.events.Event<(downloadDelta: DownloadDelta) => void> {}

  export interface DownloadCreatedEvent
    extends chrome.events.Event<(downloadItem: DownloadItem) => void> {}

  export interface DownloadErasedEvent
    extends chrome.events.Event<(downloadId: number) => void> {}

  export interface DownloadDeterminingFilenameEvent
    extends chrome.events.Event<
      (
        downloadItem: DownloadItem,
        suggest: (suggestion?: DownloadFilenameSuggestion) => void
      ) => void
    > {}

  export function search(query: DownloadQuery): Promise<DownloadItem[]>

  export function search(
    query: DownloadQuery,
    callback: (results: DownloadItem[]) => void
  ): void

  export function pause(downloadId: number): Promise<void>

  export function pause(downloadId: number, callback: () => void): void

  export function getFileIcon(
    downloadId: number,
    options?: GetFileIconOptions
  ): Promise<string>

  export function getFileIcon(
    downloadId: number,
    callback: (iconURL: string) => void
  ): void

  export function getFileIcon(
    downloadId: number,
    options: GetFileIconOptions,
    callback: (iconURL: string) => void
  ): void

  export function resume(downloadId: number): Promise<void>

  export function resume(downloadId: number, callback: () => void): void

  export function cancel(downloadId: number): Promise<void>

  export function cancel(downloadId: number, callback: () => void): void

  export function download(options: DownloadOptions): Promise<number>

  export function download(
    options: DownloadOptions,
    callback: (downloadId: number) => void
  ): void

  export function open(downloadId: number): void

  export function show(downloadId: number): void

  export function showDefaultFolder(): void

  export function erase(query: DownloadQuery): Promise<number[]>

  export function erase(
    query: DownloadQuery,
    callback: (erasedIds: number[]) => void
  ): void

  export function removeFile(downloadId: number): Promise<void>

  export function removeFile(downloadId: number, callback?: () => void): void

  export function acceptDanger(downloadId: number): Promise<void>

  export function acceptDanger(downloadId: number, callback: () => void): void

  export function drag(downloadId: number): void

  export function setShelfEnabled(enabled: boolean): void

  export function setUiOptions(options: UiOptions): Promise<void>

  export function setUiOptions(options: UiOptions, callback: () => void): void

  export var onChanged: DownloadChangedEvent

  export var onCreated: DownloadCreatedEvent

  export var onErased: DownloadErasedEvent

  export var onDeterminingFilename: DownloadDeterminingFilenameEvent
}

declare namespace chrome.enterprise.platformKeys {
  export interface Token {
    id: string

    subtleCrypto: SubtleCrypto

    softwareBackedSubtleCrypto: SubtleCrypto
  }

  export function getTokens(callback: (tokens: Token[]) => void): void

  export function getCertificates(
    tokenId: string,
    callback: (certificates: ArrayBuffer[]) => void
  ): void

  export function importCertificate(
    tokenId: string,
    certificate: ArrayBuffer,
    callback?: () => void
  ): void

  export function removeCertificate(
    tokenId: string,
    certificate: ArrayBuffer,
    callback?: () => void
  ): void

  export function challengeMachineKey(
    challenge: ArrayBuffer,
    registerKey: boolean,
    callback: (response: ArrayBuffer) => void
  ): void
  export function challengeMachineKey(
    challenge: ArrayBuffer,
    callback: (response: ArrayBuffer) => void
  ): void

  export function challengeUserKey(
    challenge: ArrayBuffer,
    registerKey: boolean,
    callback: (response: ArrayBuffer) => void
  ): void
}

declare namespace chrome.enterprise.deviceAttributes {
  export function getDirectoryDeviceId(
    callback: (deviceId: string) => void
  ): void

  export function getDeviceSerialNumber(
    callback: (serialNumber: string) => void
  ): void

  export function getDeviceAssetId(callback: (assetId: string) => void): void

  export function getDeviceAnnotatedLocation(
    callback: (annotatedLocation: string) => void
  ): void

  export function getDeviceHostname(callback: (hostname: string) => void): void
}

declare namespace chrome.enterprise.networkingAttributes {
  export interface NetworkDetails {
    macAddress: string

    ipv4?: string | undefined

    ipv6?: string | undefined
  }

  export function getNetworkDetails(
    callback: (networkDetails: NetworkDetails) => void
  ): void
}

declare namespace chrome.events {
  export interface UrlFilter {
    schemes?: string[] | undefined

    urlMatches?: string | undefined

    pathContains?: string | undefined

    hostSuffix?: string | undefined

    hostPrefix?: string | undefined

    hostContains?: string | undefined

    urlContains?: string | undefined

    querySuffix?: string | undefined

    urlPrefix?: string | undefined

    hostEquals?: string | undefined

    urlEquals?: string | undefined

    queryContains?: string | undefined

    pathPrefix?: string | undefined

    pathEquals?: string | undefined

    pathSuffix?: string | undefined

    queryEquals?: string | undefined

    queryPrefix?: string | undefined

    urlSuffix?: string | undefined

    ports?: Array<number | number[]> | undefined

    originAndPathMatches?: string | undefined
  }

  export interface BaseEvent<T extends Function> {
    addListener(callback: T, filter?: webRequest.RequestFilter): void

    getRules(callback: (rules: Rule[]) => void): void

    getRules(ruleIdentifiers: string[], callback: (rules: Rule[]) => void): void

    hasListener(callback: T): boolean

    removeRules(ruleIdentifiers?: string[], callback?: () => void): void

    removeRules(callback?: () => void): void

    addRules(rules: Rule[], callback?: (rules: Rule[]) => void): void

    removeListener(callback: T): void
    hasListeners(): boolean
  }

  interface Event<T extends Function> extends BaseEvent<T> {
    addListener(callback: T): void
  }
  export interface EventWithRequiredFilterInAddListener<T extends Function>
    extends BaseEvent<T> {
    addListener(callback: T, filter: webRequest.RequestFilter): void
  }

  export interface Rule {
    priority?: number | undefined

    conditions: any[]

    id?: string | undefined

    actions: any[]

    tags?: string[] | undefined
  }
}

declare namespace chrome.extension {
  export interface FetchProperties {
    tabId?: number | undefined

    windowId?: number | undefined

    type?: string | undefined
  }

  export interface LastError {
    message: string
  }

  export interface OnRequestEvent
    extends chrome.events.Event<
      | ((
          request: any,
          sender: runtime.MessageSender,
          sendResponse: (response: any) => void
        ) => void)
      | ((
          sender: runtime.MessageSender,
          sendResponse: (response: any) => void
        ) => void)
    > {}

  export var inIncognitoContext: boolean

  export var lastError: LastError

  export function getBackgroundPage(): Window | null

  export function getURL(path: string): string

  export function setUpdateUrlData(data: string): void

  export function getViews(fetchProperties?: FetchProperties): Window[]

  export function isAllowedFileSchemeAccess(): Promise<boolean>

  export function isAllowedFileSchemeAccess(
    callback: (isAllowedAccess: boolean) => void
  ): void

  export function isAllowedIncognitoAccess(): Promise<boolean>

  export function isAllowedIncognitoAccess(
    callback: (isAllowedAccess: boolean) => void
  ): void

  export function sendRequest<Request = any, Response = any>(
    extensionId: string,
    request: Request,
    responseCallback?: (response: Response) => void
  ): void

  export function sendRequest<Request = any, Response = any>(
    request: Request,
    responseCallback?: (response: Response) => void
  ): void

  export function getExtensionTabs(windowId?: number): Window[]

  export var onRequest: OnRequestEvent

  export var onRequestExternal: OnRequestEvent
}

declare namespace chrome.fileBrowserHandler {
  export interface SelectionParams {
    allowedFileExtensions?: string[] | undefined

    suggestedName: string
  }

  export interface SelectionResult {
    entry?: Object | null | undefined

    success: boolean
  }

  export interface FileHandlerExecuteEventDetails {
    tab_id?: number | undefined

    entries: any[]
  }

  export interface FileBrowserHandlerExecuteEvent
    extends chrome.events.Event<
      (id: string, details: FileHandlerExecuteEventDetails) => void
    > {}

  export function selectFile(
    selectionParams: SelectionParams,
    callback: (result: SelectionResult) => void
  ): void

  export var onExecute: FileBrowserHandlerExecuteEvent
}

declare namespace chrome.fileSystemProvider {
  export interface OpenedFileInfo {
    openRequestId: number

    filePath: string

    mode: string
  }

  export interface FileWatchersInfo {
    entryPath: string

    recursive: boolean

    lastTag?: string | undefined
  }

  export interface CloudIdentifier {
    providerName: string

    id: string
  }

  export interface EntryMetadata {
    isDirectory?: boolean

    name?: string

    size?: number

    modificationTime?: Date

    mimeType?: string | undefined

    thumbnail?: string | undefined

    cloudIdentifier?: CloudIdentifier | undefined
  }

  export interface FileSystemInfo {
    fileSystemId: string

    displayName: string

    writable: boolean

    openedFilesLimit: number

    openedFiles: OpenedFileInfo[]

    supportsNotifyTag?: boolean | undefined

    watchers: FileWatchersInfo[]
  }

  export interface GetActionsRequestedOptions {
    fileSystemId: string

    requestId: number

    entryPaths: string[]
  }

  export interface Action {
    id: string

    title?: string | undefined
  }

  export interface ExecuteActionRequestedOptions {
    fileSystemId: string

    requestId: number

    entryPaths: string[]

    actionId: string
  }

  export interface MountOptions {
    fileSystemId: string

    displayName: string

    writable?: boolean | undefined

    openedFilesLimit?: number | undefined

    supportsNotifyTag?: boolean | undefined
  }

  export interface UnmountOptions {
    fileSystemId: string
  }

  export interface NotificationChange {
    entryPath: string

    changeType: string
  }

  export interface NotificationOptions {
    fileSystemId: string

    observedPath: string

    recursive: boolean

    changeType: string

    changes?: NotificationChange[] | undefined

    tag?: string | undefined
  }

  export interface RequestedEventOptions {
    fileSystemId: string

    requestId: number
  }

  export interface EntryPathRequestedEventOptions
    extends RequestedEventOptions {
    entryPath: string
  }

  export interface MetadataRequestedEventOptions
    extends EntryPathRequestedEventOptions {
    isDirectory: boolean

    name: boolean

    size: boolean

    modificationTime: boolean

    mimeType: boolean

    thumbnail: boolean

    cloudIdentifier: boolean
  }

  export interface DirectoryPathRequestedEventOptions
    extends RequestedEventOptions {
    directoryPath: string

    isDirectory: boolean

    name: boolean

    size: boolean

    modificationTime: boolean

    mimeType: boolean

    thumbnail: boolean
  }

  export interface FilePathRequestedEventOptions extends RequestedEventOptions {
    filePath: string
  }

  export interface OpenFileRequestedEventOptions
    extends FilePathRequestedEventOptions {
    mode: string
  }

  export interface OpenedFileRequestedEventOptions
    extends RequestedEventOptions {
    openRequestId: number
  }

  export interface OpenedFileOffsetRequestedEventOptions
    extends OpenedFileRequestedEventOptions {
    offset: number

    length: number
  }

  export interface CreateDirectoryRequestedEventOptions
    extends RequestedEventOptions {
    directoryPath: string

    recursive: boolean
  }

  export interface EntryPathRecursiveRequestedEventOptions
    extends EntryPathRequestedEventOptions {
    recursive: boolean
  }

  export interface SourceTargetPathRequestedEventOptions
    extends RequestedEventOptions {
    sourcePath: string

    targetPath: string
  }

  export interface FilePathLengthRequestedEventOptions
    extends FilePathRequestedEventOptions {
    length: number
  }

  export interface OpenedFileIoRequestedEventOptions
    extends OpenedFileRequestedEventOptions {
    offset: number

    data: ArrayBuffer
  }

  export interface OperationRequestedEventOptions
    extends RequestedEventOptions {
    operationRequestId: number
  }

  export interface RequestedEvent
    extends chrome.events.Event<
      (
        options: RequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface MetadataRequestedEvent
    extends chrome.events.Event<
      (
        options: MetadataRequestedEventOptions,
        successCallback: (metadata: EntryMetadata) => void,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface DirectoryPathRequestedEvent
    extends chrome.events.Event<
      (
        options: DirectoryPathRequestedEventOptions,
        successCallback: (entries: EntryMetadata[], hasMore: boolean) => void,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface OpenFileRequestedEvent
    extends chrome.events.Event<
      (
        options: OpenFileRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface OpenedFileRequestedEvent
    extends chrome.events.Event<
      (
        options: OpenedFileRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface OpenedFileOffsetRequestedEvent
    extends chrome.events.Event<
      (
        options: OpenedFileOffsetRequestedEventOptions,
        successCallback: (data: ArrayBuffer, hasMore: boolean) => void,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface CreateDirectoryRequestedEvent
    extends chrome.events.Event<
      (
        options: CreateDirectoryRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface EntryPathRecursiveRequestedEvent
    extends chrome.events.Event<
      (
        options: EntryPathRecursiveRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface FilePathRequestedEvent
    extends chrome.events.Event<
      (
        options: FilePathRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface SourceTargetPathRequestedEvent
    extends chrome.events.Event<
      (
        options: SourceTargetPathRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface FilePathLengthRequestedEvent
    extends chrome.events.Event<
      (
        options: FilePathLengthRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface OpenedFileIoRequestedEvent
    extends chrome.events.Event<
      (
        options: OpenedFileIoRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface OperationRequestedEvent
    extends chrome.events.Event<
      (
        options: OperationRequestedEventOptions,
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface OptionlessRequestedEvent
    extends chrome.events.Event<
      (
        successCallback: Function,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface GetActionsRequested
    extends chrome.events.Event<
      (
        options: GetActionsRequestedOptions,
        successCallback: (actions: Action[]) => void,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export interface ExecuteActionRequested
    extends chrome.events.Event<
      (
        options: ExecuteActionRequestedOptions,
        successCallback: () => void,
        errorCallback: (error: string) => void
      ) => void
    > {}

  export function mount(options: MountOptions, callback?: () => void): void

  export function unmount(options: UnmountOptions, callback?: () => void): void

  export function getAll(
    callback: (fileSystems: FileSystemInfo[]) => void
  ): void

  export function get(
    fileSystemId: string,
    callback: (fileSystem: FileSystemInfo) => void
  ): void

  export function notify(
    options: NotificationOptions,
    callback: () => void
  ): void

  export var onUnmountRequested: RequestedEvent

  export var onGetMetadataRequested: MetadataRequestedEvent

  export var onReadDirectoryRequested: DirectoryPathRequestedEvent

  export var onOpenFileRequested: OpenFileRequestedEvent

  export var onCloseFileRequested: OpenedFileRequestedEvent

  export var onReadFileRequested: OpenedFileOffsetRequestedEvent

  export var onCreateDirectoryRequested: CreateDirectoryRequestedEvent

  export var onDeleteEntryRequested: EntryPathRecursiveRequestedEvent

  export var onCreateFileRequested: FilePathRequestedEvent

  export var onCopyEntryRequested: SourceTargetPathRequestedEvent

  export var onMoveEntryRequested: SourceTargetPathRequestedEvent

  export var onTruncateRequested: FilePathLengthRequestedEvent

  export var onWriteFileRequested: OpenedFileIoRequestedEvent

  export var onAbortRequested: OperationRequestedEvent

  export var onConfigureRequested: RequestedEvent

  export var onMountRequested: OptionlessRequestedEvent

  export var onAddWatcherRequested: EntryPathRecursiveRequestedEvent

  export var onRemoveWatcherRequested: EntryPathRecursiveRequestedEvent

  export var onGetActionsRequested: GetActionsRequested

  export var onExecuteActionRequested: ExecuteActionRequested
}

declare namespace chrome.fontSettings {
  export interface FontName {
    displayName: string

    fontId: string
  }

  export interface DefaultFontSizeDetails {
    pixelSize: number
  }

  export interface FontDetails {
    genericFamily:
      | 'cursive'
      | 'fantasy'
      | 'fixed'
      | 'sansserif'
      | 'serif'
      | 'standard'

    script?: string | undefined
  }

  export interface FullFontDetails {
    genericFamily: string

    levelOfControl: string

    script?: string | undefined

    fontId: string
  }

  export interface FontDetailsResult {
    levelOfControl: string

    fontId: string
  }

  export interface FontSizeDetails {
    pixelSize: number

    levelOfControl: string
  }

  export interface SetFontSizeDetails {
    pixelSize: number
  }

  export interface SetFontDetails extends FontDetails {
    fontId: string
  }

  export interface DefaultFixedFontSizeChangedEvent
    extends chrome.events.Event<(details: FontSizeDetails) => void> {}

  export interface DefaultFontSizeChangedEvent
    extends chrome.events.Event<(details: FontSizeDetails) => void> {}

  export interface MinimumFontSizeChangedEvent
    extends chrome.events.Event<(details: FontSizeDetails) => void> {}

  export interface FontChangedEvent
    extends chrome.events.Event<(details: FullFontDetails) => void> {}

  export function setDefaultFontSize(
    details: DefaultFontSizeDetails
  ): Promise<void>

  export function setDefaultFontSize(
    details: DefaultFontSizeDetails,
    callback: Function
  ): void

  export function getFont(details: FontDetails): Promise<FontDetailsResult>

  export function getFont(
    details: FontDetails,
    callback: (details: FontDetailsResult) => void
  ): void

  export function getDefaultFontSize(details?: Object): Promise<FontSizeDetails>

  export function getDefaultFontSize(
    callback: (options: FontSizeDetails) => void
  ): void
  export function getDefaultFontSize(
    details: Object,
    callback: (options: FontSizeDetails) => void
  ): void

  export function getMinimumFontSize(details?: object): Promise<FontSizeDetails>

  export function getMinimumFontSize(
    callback: (options: FontSizeDetails) => void
  ): void
  export function getMinimumFontSize(
    details: object,
    callback: (options: FontSizeDetails) => void
  ): void

  export function setMinimumFontSize(details: SetFontSizeDetails): Promise<void>

  export function setMinimumFontSize(
    details: SetFontSizeDetails,
    callback: Function
  ): void

  export function getDefaultFixedFontSize(
    details?: Object
  ): Promise<FontSizeDetails>

  export function getDefaultFixedFontSize(
    callback: (details: FontSizeDetails) => void
  ): void
  export function getDefaultFixedFontSize(
    details: Object,
    callback: (details: FontSizeDetails) => void
  ): void

  export function clearDefaultFontSize(details?: Object): Promise<void>

  export function clearDefaultFontSize(callback: Function): void
  export function clearDefaultFontSize(
    details: Object,
    callback: Function
  ): void

  export function setDefaultFixedFontSize(
    details: SetFontSizeDetails
  ): Promise<void>

  export function setDefaultFixedFontSize(
    details: SetFontSizeDetails,
    callback: Function
  ): void

  export function clearFont(details: FontDetails): Promise<void>

  export function clearFont(details: FontDetails, callback: Function): void

  export function setFont(details: SetFontDetails): Promise<void>

  export function setFont(details: SetFontDetails, callback: Function): void

  export function clearMinimumFontSize(details?: Object): Promise<void>

  export function clearMinimumFontSize(callback: Function): void
  export function clearMinimumFontSize(
    details: Object,
    callback: Function
  ): void

  export function getFontList(): Promise<FontName[]>

  export function getFontList(callback: (results: FontName[]) => void): void

  export function clearDefaultFixedFontSize(details: Object): Promise<void>

  export function clearDefaultFixedFontSize(
    details: Object,
    callback: Function
  ): void

  export var onDefaultFixedFontSizeChanged: DefaultFixedFontSizeChangedEvent

  export var onDefaultFontSizeChanged: DefaultFontSizeChangedEvent

  export var onMinimumFontSizeChanged: MinimumFontSizeChangedEvent

  export var onFontChanged: FontChangedEvent
}

declare namespace chrome.gcm {
  export interface OutgoingMessage {
    destinationId: string

    messageId: string

    timeToLive?: number | undefined

    data: Object
  }

  export interface IncomingMessage {
    data: Object

    from?: string | undefined

    collapseKey?: string | undefined
  }

  export interface GcmError {
    errorMessage: string

    messageId?: string | undefined

    detail: Object
  }

  export interface MessageReceptionEvent
    extends chrome.events.Event<(message: IncomingMessage) => void> {}

  export interface MessageDeletionEvent
    extends chrome.events.Event<() => void> {}

  export interface GcmErrorEvent
    extends chrome.events.Event<(error: GcmError) => void> {}

  export var MAX_MESSAGE_SIZE: number

  export function register(
    senderIds: string[],
    callback: (registrationId: string) => void
  ): void

  export function unregister(callback: () => void): void

  export function send(
    message: OutgoingMessage,
    callback: (messageId: string) => void
  ): void

  export var onMessage: MessageReceptionEvent

  export var onMessagesDeleted: MessageDeletionEvent

  export var onSendError: GcmErrorEvent
}

declare namespace chrome.history {
  export interface VisitItem {
    transition: string

    visitTime?: number | undefined

    visitId: string

    referringVisitId: string

    id: string
  }

  export interface HistoryItem {
    typedCount?: number | undefined

    title?: string | undefined

    url?: string | undefined

    lastVisitTime?: number | undefined

    visitCount?: number | undefined

    id: string
  }

  export interface HistoryQuery {
    text: string

    maxResults?: number | undefined

    startTime?: number | undefined

    endTime?: number | undefined
  }

  export interface Url {
    url: string
  }

  export interface Range {
    endTime: number

    startTime: number
  }

  export interface RemovedResult {
    allHistory: boolean

    urls?: string[] | undefined
  }

  export interface HistoryVisitedEvent
    extends chrome.events.Event<(result: HistoryItem) => void> {}

  export interface HistoryVisitRemovedEvent
    extends chrome.events.Event<(removed: RemovedResult) => void> {}

  export function search(query: HistoryQuery): Promise<HistoryItem[]>

  export function search(
    query: HistoryQuery,
    callback: (results: HistoryItem[]) => void
  ): void

  export function addUrl(details: Url): Promise<void>

  export function addUrl(details: Url, callback: () => void): void

  export function deleteRange(range: Range): Promise<void>

  export function deleteRange(range: Range, callback: () => void): void

  export function deleteAll(): Promise<void>

  export function deleteAll(callback: () => void): void

  export function getVisits(details: Url): Promise<VisitItem[]>

  export function getVisits(
    details: Url,
    callback: (results: VisitItem[]) => void
  ): void

  export function deleteUrl(details: Url): Promise<void>

  export function deleteUrl(details: Url, callback: () => void): void

  export var onVisited: HistoryVisitedEvent

  export var onVisitRemoved: HistoryVisitRemovedEvent
}

declare namespace chrome.i18n {
  export interface DetectedLanguage {
    language: string

    percentage: number
  }

  export interface LanguageDetectionResult {
    isReliable: boolean

    languages: DetectedLanguage[]
  }

  export function getAcceptLanguages(): Promise<string[]>

  export function getAcceptLanguages(
    callback: (languages: string[]) => void
  ): void

  export function getMessage(
    messageName: string,
    substitutions?: string | string[]
  ): string

  export function getUILanguage(): string

  export function detectLanguage(text: string): Promise<LanguageDetectionResult>

  export function detectLanguage(
    text: string,
    callback: (result: LanguageDetectionResult) => void
  ): void
}

declare namespace chrome.identity {
  export interface AccountInfo {
    id: string
  }

  export enum AccountStatus {
    SYNC = 'SYNC',
    ANY = 'ANY'
  }

  export interface ProfileDetails {
    accountStatus?: AccountStatus | undefined
  }

  export interface TokenDetails {
    interactive?: boolean | undefined

    account?: AccountInfo | undefined

    scopes?: string[] | undefined
  }

  export interface UserInfo {
    email: string

    id: string
  }

  export interface TokenInformation {
    token: string
  }

  export interface WebAuthFlowOptions {
    url: string

    interactive?: boolean | undefined
  }

  export interface SignInChangeEvent
    extends chrome.events.Event<
      (account: AccountInfo, signedIn: boolean) => void
    > {}

  export interface GetAuthTokenResult {
    grantedScopes?: string[]

    token?: string
  }

  export function clearAllCachedAuthTokens(): Promise<void>
  export function clearAllCachedAuthTokens(callback: () => void): void

  export function getAccounts(): Promise<AccountInfo[]>
  export function getAccounts(callback: (accounts: AccountInfo[]) => void): void

  export function getAuthToken(
    details: TokenDetails
  ): Promise<GetAuthTokenResult>
  export function getAuthToken(
    details: TokenDetails,
    callback: (token?: string, grantedScopes?: string[]) => void
  ): void

  export function getProfileUserInfo(
    callback: (userInfo: UserInfo) => void
  ): void

  export function getProfileUserInfo(
    details: ProfileDetails,
    callback: (userInfo: UserInfo) => void
  ): void

  export function getProfileUserInfo(details: ProfileDetails): Promise<UserInfo>

  export function removeCachedAuthToken(
    details: TokenInformation
  ): Promise<void>
  export function removeCachedAuthToken(
    details: TokenInformation,
    callback: () => void
  ): void

  export function launchWebAuthFlow(
    details: WebAuthFlowOptions,
    callback: (responseUrl?: string) => void
  ): void
  export function launchWebAuthFlow(
    details: WebAuthFlowOptions
  ): Promise<string | undefined>

  export function getRedirectURL(path?: string): string

  export var onSignInChanged: SignInChangeEvent
}

declare namespace chrome.idle {
  export type IdleState = 'active' | 'idle' | 'locked'
  export interface IdleStateChangedEvent
    extends chrome.events.Event<(newState: IdleState) => void> {}

  export function queryState(
    detectionIntervalInSeconds: number,
    callback: (newState: IdleState) => void
  ): void

  export function setDetectionInterval(intervalInSeconds: number): void

  export function getAutoLockDelay(callback: (delay: number) => void): void

  export var onStateChanged: IdleStateChangedEvent
}

declare namespace chrome.input.ime {
  export interface KeyboardEvent {
    shiftKey?: boolean | undefined

    altKey?: boolean | undefined

    altgrKey?: boolean | undefined

    requestId?: string | undefined

    key: string

    ctrlKey?: boolean | undefined

    type: string

    extensionId?: string | undefined

    code: string

    keyCode?: number | undefined

    capsLock?: boolean | undefined
  }

  export type AutoCapitalizeType = 'characters' | 'words' | 'sentences'

  export interface InputContext {
    contextID: number

    type: string

    autoCorrect: boolean

    autoComplete: boolean

    spellCheck: boolean

    autoCapitalize: AutoCapitalizeType

    shouldDoLearning: boolean
  }

  export interface MenuItem {
    id: string

    label?: string | undefined

    style?: string | undefined

    visible?: boolean | undefined

    checked?: boolean | undefined

    enabled?: boolean | undefined
  }

  export interface ImeParameters {
    items: MenuItem[]

    engineID: string
  }

  export interface CommitTextParameters {
    text: string

    contextID: number
  }

  export interface CandidateUsage {
    title: string

    body: string
  }

  export interface CandidateTemplate {
    candidate: string

    id: number

    parentId?: number | undefined

    label?: string | undefined

    annotation?: string | undefined

    usage?: CandidateUsage | undefined
  }

  export interface CandidatesParameters {
    contextID: number

    candidates: CandidateTemplate[]
  }

  export interface CompositionParameterSegment {
    start: number

    end: number

    style: string
  }

  export interface CompositionParameters {
    contextID: number

    text: string

    segments?: CompositionParameterSegment[] | undefined

    cursor: number

    selectionStart?: number | undefined

    selectionEnd?: number | undefined
  }

  export interface MenuItemParameters {
    items: Object[]
    engineId: string
  }

  export type AssistiveWindowType = 'undo'

  export type AssistiveWindowButton = 'undo' | 'addToDictionary'

  export interface AssistiveWindowProperties {
    type: AssistiveWindowType
    visible: boolean
    announceString?: string | undefined
  }

  export interface CandidateWindowParameterProperties {
    cursorVisible?: boolean | undefined

    vertical?: boolean | undefined

    pageSize?: number | undefined

    auxiliaryTextVisible?: boolean | undefined

    auxiliaryText?: string | undefined

    visible?: boolean | undefined

    windowPosition?: string | undefined

    currentCandidateIndex?: number | undefined

    totalCandidates?: number | undefined
  }

  export interface CandidateWindowParameter {
    engineID: string
    properties: CandidateWindowParameterProperties
  }

  export interface ClearCompositionParameters {
    contextID: number
  }

  export interface CursorPositionParameters {
    candidateID: number

    contextID: number
  }

  export interface SendKeyEventParameters {
    contextID: number

    keyData: KeyboardEvent[]
  }

  export interface DeleteSurroundingTextParameters {
    engineID: string

    contextID: number

    offset: number

    length: number
  }

  export interface SurroundingTextInfo {
    text: string

    focus: number

    anchor: number
  }

  export interface AssistiveWindowButtonClickedDetails {
    buttonID: AssistiveWindowButton

    windowType: AssistiveWindowType
  }

  export interface BlurEvent
    extends chrome.events.Event<(contextID: number) => void> {}

  export interface AssistiveWindowButtonClickedEvent
    extends chrome.events.Event<
      (details: AssistiveWindowButtonClickedDetails) => void
    > {}

  export interface CandidateClickedEvent
    extends chrome.events.Event<
      (engineID: string, candidateID: number, button: string) => void
    > {}

  export interface KeyEventEvent
    extends chrome.events.Event<
      (engineID: string, keyData: KeyboardEvent, requestId: string) => void
    > {}

  export interface DeactivatedEvent
    extends chrome.events.Event<(engineID: string) => void> {}

  export interface InputContextUpdateEvent
    extends chrome.events.Event<(context: InputContext) => void> {}

  export interface ActivateEvent
    extends chrome.events.Event<(engineID: string, screen: string) => void> {}

  export interface FocusEvent
    extends chrome.events.Event<(context: InputContext) => void> {}

  export interface MenuItemActivatedEvent
    extends chrome.events.Event<(engineID: string, name: string) => void> {}

  export interface SurroundingTextChangedEvent
    extends chrome.events.Event<
      (engineID: string, surroundingInfo: SurroundingTextInfo) => void
    > {}

  export interface InputResetEvent
    extends chrome.events.Event<(engineID: string) => void> {}

  export function setMenuItems(
    parameters: ImeParameters,
    callback?: () => void
  ): void

  export function commitText(
    parameters: CommitTextParameters,
    callback?: (success: boolean) => void
  ): void

  export function setCandidates(
    parameters: CandidatesParameters,
    callback?: (success: boolean) => void
  ): void

  export function setComposition(
    parameters: CompositionParameters,
    callback?: (success: boolean) => void
  ): void

  export function updateMenuItems(
    parameters: MenuItemParameters,
    callback?: () => void
  ): void

  export function setAssistiveWindowProperties(
    parameters: {
      contextID: number
      properties: chrome.input.ime.AssistiveWindowProperties
    },
    callback?: (success: boolean) => void
  ): void

  export function setAssistiveWindowButtonHighlighted(
    parameters: {
      contextID: number
      buttonID: chrome.input.ime.AssistiveWindowButton
      windowType: chrome.input.ime.AssistiveWindowType
      announceString?: string | undefined
      highlighted: boolean
    },
    callback?: () => void
  ): void

  export function setCandidateWindowProperties(
    parameters: CandidateWindowParameter,
    callback?: (success: boolean) => void
  ): void

  export function clearComposition(
    parameters: ClearCompositionParameters,
    callback?: (success: boolean) => void
  ): void

  export function setCursorPosition(
    parameters: CursorPositionParameters,
    callback?: (success: boolean) => void
  ): void

  export function sendKeyEvents(
    parameters: SendKeyEventParameters,
    callback?: () => void
  ): void

  export function hideInputView(): void

  export function deleteSurroundingText(
    parameters: DeleteSurroundingTextParameters,
    callback?: () => void
  ): void

  export function keyEventHandled(requestId: string, response: boolean): void

  export var onBlur: BlurEvent

  export var onAssistiveWindowButtonClicked: AssistiveWindowButtonClickedEvent

  export var onCandidateClicked: CandidateClickedEvent

  export var onKeyEvent: KeyEventEvent

  export var onDeactivated: DeactivatedEvent

  export var onInputContextUpdate: InputContextUpdateEvent

  export var onActivate: ActivateEvent

  export var onFocus: FocusEvent

  export var onMenuItemActivated: MenuItemActivatedEvent

  export var onSurroundingTextChanged: SurroundingTextChangedEvent

  export var onReset: InputResetEvent
}

declare namespace chrome.instanceID {
  export interface TokenRefreshEvent extends chrome.events.Event<() => void> {}

  export function deleteID(): Promise<void>
  export function deleteID(callback: () => void): void

  interface DeleteTokenParams {
    authorizedEntity: string

    scope: string
  }

  export function deleteToken(
    deleteTokenParams: DeleteTokenParams
  ): Promise<void>
  export function deleteToken(
    deleteTokenParams: DeleteTokenParams,
    callback: () => void
  ): void

  export function getCreationTime(): Promise<number>
  export function getCreationTime(
    callback: (creationTime: number) => void
  ): void

  export function getID(): Promise<string>
  export function getID(callback: (instanceID: string) => void): void

  interface GetTokenParams extends DeleteTokenParams {
    options?: {[key: string]: string}
  }

  export function getToken(getTokenParams: GetTokenParams): Promise<string>
  export function getToken(
    getTokenParams: GetTokenParams,
    callback: (token: string) => void
  ): void

  export var onTokenRefresh: TokenRefreshEvent
}

declare namespace chrome.loginState {
  export interface SessionStateChangedEvent
    extends chrome.events.Event<(sessionState: SessionState) => void> {}

  export type ProfileType = 'SIGNIN_PROFILE' | 'USER_PROFILE'

  export type SessionState =
    | 'UNKNOWN'
    | 'IN_OOBE_SCREEN'
    | 'IN_LOGIN_SCREEN'
    | 'IN_SESSION'
    | 'IN_LOCK_SCREEN'

  export function getProfileType(
    callback: (profileType: ProfileType) => void
  ): void

  export function getSessionState(
    callback: (sessionState: SessionState) => void
  ): void

  export const onSessionStateChanged: SessionStateChangedEvent
}

declare namespace chrome.management {
  export interface ExtensionInfo {
    disabledReason?: string | undefined

    appLaunchUrl?: string | undefined

    description: string

    permissions: string[]

    icons?: IconInfo[] | undefined

    hostPermissions: string[]

    enabled: boolean

    homepageUrl?: string | undefined

    mayDisable: boolean

    installType: string

    version: string

    id: string

    offlineEnabled: boolean

    updateUrl?: string | undefined

    type: string

    optionsUrl: string

    name: string

    shortName: string

    isApp: boolean

    launchType?: string | undefined

    availableLaunchTypes?: string[] | undefined
  }

  export interface IconInfo {
    url: string

    size: number
  }

  export interface UninstallOptions {
    showConfirmDialog?: boolean | undefined
  }

  export interface ManagementDisabledEvent
    extends chrome.events.Event<(info: ExtensionInfo) => void> {}

  export interface ManagementUninstalledEvent
    extends chrome.events.Event<(id: string) => void> {}

  export interface ManagementInstalledEvent
    extends chrome.events.Event<(info: ExtensionInfo) => void> {}

  export interface ManagementEnabledEvent
    extends chrome.events.Event<(info: ExtensionInfo) => void> {}

  export function setEnabled(id: string, enabled: boolean): Promise<void>

  export function setEnabled(
    id: string,
    enabled: boolean,
    callback: () => void
  ): void

  export function getPermissionWarningsById(id: string): Promise<string[]>

  export function getPermissionWarningsById(
    id: string,
    callback: (permissionWarnings: string[]) => void
  ): void

  export function get(id: string): Promise<ExtensionInfo>

  export function get(
    id: string,
    callback: (result: ExtensionInfo) => void
  ): void

  export function getAll(): Promise<ExtensionInfo[]>

  export function getAll(callback: (result: ExtensionInfo[]) => void): void

  export function getPermissionWarningsByManifest(
    manifestStr: string
  ): Promise<string[]>

  export function getPermissionWarningsByManifest(
    manifestStr: string,
    callback: (permissionwarnings: string[]) => void
  ): void

  export function launchApp(id: string): Promise<void>

  export function launchApp(id: string, callback: () => void): void

  export function uninstall(
    id: string,
    options?: UninstallOptions
  ): Promise<void>

  export function uninstall(id: string, callback: () => void): void
  export function uninstall(
    id: string,
    options: UninstallOptions,
    callback: () => void
  ): void

  export function uninstall(id: string): Promise<void>

  export function uninstall(id: string, callback: () => void): void

  export function getSelf(): Promise<ExtensionInfo>

  export function getSelf(callback: (result: ExtensionInfo) => void): void

  export function uninstallSelf(options?: UninstallOptions): Promise<void>

  export function uninstallSelf(callback: () => void): void
  export function uninstallSelf(
    options: UninstallOptions,
    callback: () => void
  ): void

  export function uninstallSelf(): Promise<void>

  export function uninstallSelf(callback: () => void): void

  export function createAppShortcut(id: string): Promise<void>

  export function createAppShortcut(id: string, callback: () => void): void

  export function setLaunchType(id: string, launchType: string): Promise<void>

  export function setLaunchType(
    id: string,
    launchType: string,
    callback: () => void
  ): void

  export function generateAppForLink(
    url: string,
    title: string
  ): Promise<ExtensionInfo>

  export function generateAppForLink(
    url: string,
    title: string,
    callback: (result: ExtensionInfo) => void
  ): void

  export var onDisabled: ManagementDisabledEvent

  export var onUninstalled: ManagementUninstalledEvent

  export var onInstalled: ManagementInstalledEvent

  export var onEnabled: ManagementEnabledEvent
}

declare namespace chrome.networking.config {
  export interface NetworkInfo {
    Type: string

    GUID?: string | undefined

    HexSSID?: string | undefined

    SSID?: string | undefined

    BSSID?: string | undefined

    Security?: string | undefined
  }

  export interface CaptivePorttalDetectedEvent
    extends chrome.events.Event<(networkInfo: NetworkInfo) => void> {}

  export function setNetworkFilter(
    networks: NetworkInfo[],
    callback: () => void
  ): void

  export function finishAuthentication(
    GUID: string,
    result: string,
    callback?: () => void
  ): void

  export var onCaptivePortalDetected: CaptivePorttalDetectedEvent
}

declare namespace chrome.notifications {
  export type TemplateType = 'basic' | 'image' | 'list' | 'progress'

  export interface ButtonOptions {
    title: string
    iconUrl?: string | undefined
  }

  export interface ItemOptions {
    title: string

    message: string
  }

  export type NotificationOptions<T extends boolean = false> = {
    contextMessage?: string | undefined

    priority?: number | undefined

    eventTime?: number | undefined

    buttons?: ButtonOptions[] | undefined

    items?: ItemOptions[] | undefined

    progress?: number | undefined

    isClickable?: boolean | undefined

    appIconMaskUrl?: string | undefined

    imageUrl?: string | undefined

    requireInteraction?: boolean | undefined

    silent?: boolean | undefined
  } & (T extends true
    ? {
        iconUrl: string

        message: string

        type: TemplateType

        title: string
      }
    : {
        iconUrl?: string | undefined

        message?: string | undefined

        type?: TemplateType | undefined

        title?: string | undefined
      })

  export interface NotificationClosedEvent
    extends chrome.events.Event<
      (notificationId: string, byUser: boolean) => void
    > {}

  export interface NotificationClickedEvent
    extends chrome.events.Event<(notificationId: string) => void> {}

  export interface NotificationButtonClickedEvent
    extends chrome.events.Event<
      (notificationId: string, buttonIndex: number) => void
    > {}

  export interface NotificationPermissionLevelChangedEvent
    extends chrome.events.Event<(level: string) => void> {}

  export interface NotificationShowSettingsEvent
    extends chrome.events.Event<() => void> {}

  export var onClosed: NotificationClosedEvent

  export var onClicked: NotificationClickedEvent

  export var onButtonClicked: NotificationButtonClickedEvent

  export var onPermissionLevelChanged: NotificationPermissionLevelChangedEvent

  export var onShowSettings: NotificationShowSettingsEvent

  export function create(
    notificationId: string,
    options: NotificationOptions<true>,
    callback?: (notificationId: string) => void
  ): void

  export function create(
    options: NotificationOptions<true>,
    callback?: (notificationId: string) => void
  ): void

  export function update(
    notificationId: string,
    options: NotificationOptions,
    callback?: (wasUpdated: boolean) => void
  ): void

  export function clear(
    notificationId: string,
    callback?: (wasCleared: boolean) => void
  ): void

  export function getAll(callback: (notifications: Object) => void): void

  export function getPermissionLevel(callback: (level: string) => void): void
}

declare namespace chrome.offscreen {
  export enum Reason {
    TESTING = 'TESTING',

    AUDIO_PLAYBACK = 'AUDIO_PLAYBACK',

    IFRAME_SCRIPTING = 'IFRAME_SCRIPTING',

    DOM_SCRAPING = 'DOM_SCRAPING',

    BLOBS = 'BLOBS',

    DOM_PARSER = 'DOM_PARSER',

    USER_MEDIA = 'USER_MEDIA',

    DISPLAY_MEDIA = 'DISPLAY_MEDIA',

    WEB_RTC = 'WEB_RTC',

    CLIPBOARD = 'CLIPBOARD',

    LOCAL_STORAGE = 'LOCAL_STORAGE',

    WORKERS = 'WORKERS',

    GEOLOCATION = 'GEOLOCATION'
  }

  export interface CreateParameters {
    reasons: Reason[]

    url: string

    justification: string
  }

  export function createDocument(parameters: CreateParameters): Promise<void>

  export function createDocument(
    parameters: CreateParameters,
    callback: () => void
  ): void

  export function closeDocument(): Promise<void>

  export function closeDocument(callback: () => void): void

  export function hasDocument(): Promise<boolean>

  export function hasDocument(callback: (result: boolean) => void): void
}

declare namespace chrome.omnibox {
  export interface SuggestResult {
    content: string

    description: string

    deletable?: boolean | undefined
  }

  export interface Suggestion {
    description: string
  }

  export type OnInputEnteredDisposition =
    | 'currentTab'
    | 'newForegroundTab'
    | 'newBackgroundTab'

  export interface OmniboxInputEnteredEvent
    extends chrome.events.Event<
      (text: string, disposition: OnInputEnteredDisposition) => void
    > {}

  export interface OmniboxInputChangedEvent
    extends chrome.events.Event<
      (text: string, suggest: (suggestResults: SuggestResult[]) => void) => void
    > {}

  export interface OmniboxInputStartedEvent
    extends chrome.events.Event<() => void> {}

  export interface OmniboxInputCancelledEvent
    extends chrome.events.Event<() => void> {}

  export interface OmniboxSuggestionDeletedEvent
    extends chrome.events.Event<(text: string) => void> {}

  export function setDefaultSuggestion(suggestion: Suggestion): void

  export var onInputEntered: OmniboxInputEnteredEvent

  export var onInputChanged: OmniboxInputChangedEvent

  export var onInputStarted: OmniboxInputStartedEvent

  export var onInputCancelled: OmniboxInputCancelledEvent

  export var onDeleteSuggestion: OmniboxSuggestionDeletedEvent
}

declare namespace chrome.pageAction {
  export interface PageActionClickedEvent
    extends chrome.events.Event<(tab: chrome.tabs.Tab) => void> {}

  export interface TitleDetails {
    tabId: number

    title: string
  }

  export interface GetDetails {
    tabId: number
  }

  export interface PopupDetails {
    tabId: number

    popup: string
  }

  export interface IconDetails {
    tabId: number

    iconIndex?: number | undefined

    imageData?: ImageData | {[index: number]: ImageData} | undefined

    path?: string | {[index: string]: string} | undefined
  }

  export function hide(tabId: number, callback?: () => void): void

  export function show(tabId: number, callback?: () => void): void

  export function setTitle(details: TitleDetails, callback?: () => void): void

  export function setPopup(details: PopupDetails, callback?: () => void): void

  export function getTitle(
    details: GetDetails,
    callback: (result: string) => void
  ): void

  export function getPopup(
    details: GetDetails,
    callback: (result: string) => void
  ): void

  export function setIcon(details: IconDetails, callback?: () => void): void

  export var onClicked: PageActionClickedEvent
}

declare namespace chrome.pageCapture {
  export interface SaveDetails {
    tabId: number
  }

  export function saveAsMHTML(
    details: SaveDetails,
    callback: (mhtmlData?: Blob) => void
  ): void

  export function saveAsMHTML(details: SaveDetails): Promise<Blob | undefined>
}

declare namespace chrome.permissions {
  export interface Permissions {
    permissions?: string[] | undefined

    origins?: string[] | undefined
  }

  export interface PermissionsRemovedEvent {
    addListener(callback: (permissions: Permissions) => void): void
  }

  export interface PermissionsAddedEvent {
    addListener(callback: (permissions: Permissions) => void): void
  }

  export function contains(permissions: Permissions): Promise<boolean>

  export function contains(
    permissions: Permissions,
    callback: (result: boolean) => void
  ): void

  export function getAll(): Promise<Permissions>

  export function getAll(callback: (permissions: Permissions) => void): void

  export function request(permissions: Permissions): Promise<boolean>

  export function request(
    permissions: Permissions,
    callback?: (granted: boolean) => void
  ): void

  export function remove(permissions: Permissions): Promise<boolean>

  export function remove(
    permissions: Permissions,
    callback?: (removed: boolean) => void
  ): void

  export var onRemoved: PermissionsRemovedEvent

  export var onAdded: PermissionsAddedEvent
}

declare namespace chrome.platformKeys {
  export interface Match {
    certificate: ArrayBuffer

    keyAlgorithm: KeyAlgorithm
  }

  export interface ClientCertificateSelectRequestDetails {
    certificateTypes: string[]

    certificateAuthorities: ArrayBuffer[]
  }

  export interface ClientCertificateSelectDetails {
    request: ClientCertificateSelectRequestDetails

    clientCerts?: ArrayBuffer[] | undefined

    interactive: boolean
  }

  export interface ServerCertificateVerificationDetails {
    serverCertificateChain: ArrayBuffer[]

    hostname: string
  }

  export interface ServerCertificateVerificationResult {
    trusted: boolean

    debug_errors: string[]
  }

  export function selectClientCertificates(
    details: ClientCertificateSelectDetails,
    callback: (matches: Match[]) => void
  ): void

  export function getKeyPair(
    certificate: ArrayBuffer,
    parameters: Object,
    callback: (publicKey: CryptoKey, privateKey: CryptoKey | null) => void
  ): void

  export function getKeyPairBySpki(
    publicKeySpkiDer: ArrayBuffer,
    parameters: Object,
    callback: (publicKey: CryptoKey, privateKey: CryptoKey | null) => void
  ): void

  export function subtleCrypto(): SubtleCrypto

  export function verifyTLSServerCertificate(
    details: ServerCertificateVerificationDetails,
    callback: (result: ServerCertificateVerificationResult) => void
  ): void
}

declare namespace chrome.power {
  export function requestKeepAwake(level: string): void

  export function releaseKeepAwake(): void
}

declare namespace chrome.printerProvider {
  export interface PrinterInfo {
    id: string

    name: string

    description?: string | undefined
  }

  export interface PrinterCapabilities {
    capabilities: any
  }

  export interface PrintJob {
    printerId: string

    title: string

    ticket: Object

    contentType: string

    document: Blob
  }

  export interface PrinterRequestedEvent
    extends chrome.events.Event<
      (resultCallback: (printerInfo: PrinterInfo[]) => void) => void
    > {}

  export interface PrinterInfoRequestedEvent
    extends chrome.events.Event<
      (device: any, resultCallback: (printerInfo?: PrinterInfo) => void) => void
    > {}

  export interface CapabilityRequestedEvent
    extends chrome.events.Event<
      (
        printerId: string,
        resultCallback: (capabilities: PrinterCapabilities) => void
      ) => void
    > {}

  export interface PrintRequestedEvent
    extends chrome.events.Event<
      (printJob: PrintJob, resultCallback: (result: string) => void) => void
    > {}

  export var onGetPrintersRequested: PrinterRequestedEvent

  export var onGetUsbPrinterInfoRequested: PrinterInfoRequestedEvent

  export var onGetCapabilityRequested: CapabilityRequestedEvent

  export var onPrintRequested: PrintRequestedEvent
}

declare namespace chrome.privacy {
  export interface Services {
    spellingServiceEnabled: chrome.types.ChromeSetting
    searchSuggestEnabled: chrome.types.ChromeSetting
    instantEnabled: chrome.types.ChromeSetting
    alternateErrorPagesEnabled: chrome.types.ChromeSetting
    safeBrowsingEnabled: chrome.types.ChromeSetting

    autofillEnabled: chrome.types.ChromeSetting
    translationServiceEnabled: chrome.types.ChromeSetting

    passwordSavingEnabled: chrome.types.ChromeSetting

    hotwordSearchEnabled: chrome.types.ChromeSetting

    safeBrowsingExtendedReportingEnabled: chrome.types.ChromeSetting

    autofillAddressEnabled: chrome.types.ChromeSetting

    autofillCreditCardEnabled: chrome.types.ChromeSetting
  }

  export interface Network {
    networkPredictionEnabled: chrome.types.ChromeSetting

    webRTCMultipleRoutesEnabled: chrome.types.ChromeSetting

    webRTCNonProxiedUdpEnabled: chrome.types.ChromeSetting

    webRTCIPHandlingPolicy: chrome.types.ChromeSetting
  }

  export interface Websites {
    thirdPartyCookiesAllowed: chrome.types.ChromeSetting
    referrersEnabled: chrome.types.ChromeSetting
    hyperlinkAuditingEnabled: chrome.types.ChromeSetting

    protectedContentEnabled: chrome.types.ChromeSetting

    doNotTrackEnabled: chrome.types.ChromeSetting
  }

  export var services: Services

  export var network: Network

  export var websites: Websites
}

declare namespace chrome.proxy {
  export interface PacScript {
    url?: string | undefined

    mandatory?: boolean | undefined

    data?: string | undefined
  }

  export interface ProxyConfig {
    rules?: ProxyRules | undefined

    pacScript?: PacScript | undefined

    mode: string
  }

  export interface ProxyServer {
    host: string

    scheme?: string | undefined

    port?: number | undefined
  }

  export interface ProxyRules {
    proxyForFtp?: ProxyServer | undefined

    proxyForHttp?: ProxyServer | undefined

    fallbackProxy?: ProxyServer | undefined

    singleProxy?: ProxyServer | undefined

    proxyForHttps?: ProxyServer | undefined

    bypassList?: string[] | undefined
  }

  export interface ErrorDetails {
    details: string

    error: string

    fatal: boolean
  }

  export interface ProxyErrorEvent
    extends chrome.events.Event<(details: ErrorDetails) => void> {}

  export var settings: chrome.types.ChromeSetting

  export var onProxyError: ProxyErrorEvent
}

declare namespace chrome.search {
  export type Disposition = 'CURRENT_TAB' | 'NEW_TAB' | 'NEW_WINDOW'

  export interface QueryInfo {
    disposition?: Disposition | undefined

    tabId?: number | undefined

    text?: string | undefined
  }

  export function query(options: QueryInfo, callback: () => void): void

  export function query(options: QueryInfo): Promise<void>
}

declare namespace chrome.serial {
  export const DataBits: {
    SEVEN: 'seven'
    EIGHT: 'eight'
  }
  export const ParityBit: {
    NO: 'no'
    ODD: 'odd'
    EVEN: 'even'
  }
  export const StopBits: {
    ONE: 'one'
    TWO: 'two'
  }

  export interface DeviceInfo {
    path: string

    vendorId?: number | undefined

    productId?: number | undefined

    displayName?: number | undefined
  }

  export interface ConnectionInfo {
    connectionId?: number | undefined

    paused: boolean

    persistent: boolean

    name: string

    bufferSize: number

    receiveTimeout?: number | undefined

    sendTimeout?: number | undefined

    bitrate?: number | undefined

    dataBits?: (typeof DataBits)[keyof typeof DataBits] | undefined

    parityBit?: (typeof ParityBit)[keyof typeof ParityBit] | undefined

    stopBits?: (typeof StopBits)[keyof typeof StopBits] | undefined

    ctsFlowControl?: boolean | undefined
  }

  export interface ConnectionOptions {
    persistent?: boolean | undefined

    name?: string | undefined

    bufferSize?: number | undefined

    bitrate?: number | undefined

    dataBits?: (typeof DataBits)[keyof typeof DataBits] | undefined

    parityBit?: (typeof ParityBit)[keyof typeof ParityBit] | undefined

    stopBits?: (typeof StopBits)[keyof typeof StopBits] | undefined

    ctsFlowControl?: boolean | undefined

    receiveTimeout?: number | undefined

    sendTimeout?: number | undefined
  }

  export function getDevices(callback: (ports: DeviceInfo[]) => void): void

  export function connect(
    path: string,
    options: ConnectionOptions,
    callback: (connectionInfo: ConnectionInfo) => void
  ): void

  export function update(
    connectionId: number,
    options: ConnectionOptions,
    callback: (result: boolean) => void
  ): void

  export function disconnect(
    connectionId: number,
    callback: (result: boolean) => void
  ): void

  export function setPaused(
    connectionId: number,
    paused: boolean,
    callback: () => void
  ): void

  export function getInfo(
    callback: (connectionInfos: ConnectionInfo[]) => void
  ): void

  export function getConnections(
    callback: (connectionInfos: ConnectionInfo[]) => void
  ): void

  export function send(
    connectionId: number,
    data: ArrayBuffer,
    callback: (sendInfo: object) => void
  ): void

  export function flush(
    connectionId: number,
    callback: (result: boolean) => void
  ): void

  export function getControlSignals(
    connectionId: number,
    callback: (signals: object) => void
  ): void

  export function setControlSignals(
    connectionId: number,
    signals: object,
    callback: (result: boolean) => void
  ): void

  export function setBreak(
    connectionId: number,
    callback: (result: boolean) => void
  ): void

  export function clearBreak(
    connectionId: number,
    callback: (result: boolean) => void
  ): void
}

declare namespace chrome.serial.onReceive {
  export interface OnReceiveInfo {
    connectionId: number

    data: ArrayBuffer
  }

  export function addListener(callback: (info: OnReceiveInfo) => void): void
}

declare namespace chrome.serial.onReceiveError {
  export const OnReceiveErrorEnum: {
    disconnected: 'disconnected'

    timeout: 'timeout'

    device_lost: 'device_lost'

    break: 'break'

    frame_error: 'frame_error'

    overrun: 'overrun'

    buffer_overflow: 'buffer_overflow'

    parity_error: 'parity_error'

    system_error: 'system_error'
  }

  export interface OnReceiveErrorInfo {
    connectionId: number

    error: ArrayBuffer
  }

  export function addListener(
    callback: (info: OnReceiveErrorInfo) => void
  ): void
}

type DocumentLifecycle = 'prerender' | 'active' | 'cached' | 'pending_deletion'
type FrameType = 'outermost_frame' | 'fenced_frame' | 'sub_frame'

declare namespace chrome.runtime {
  export var lastError: LastError | undefined

  export var id: string

  export type PlatformOs =
    | 'mac'
    | 'win'
    | 'android'
    | 'cros'
    | 'linux'
    | 'openbsd'

  export type PlatformArch =
    | 'arm'
    | 'arm64'
    | 'x86-32'
    | 'x86-64'
    | 'mips'
    | 'mips64'

  export type PlatformNaclArch = 'arm' | 'x86-32' | 'x86-64' | 'mips' | 'mips64'

  export enum ContextType {
    TAB = 'TAB',
    POPUP = 'POPUP',
    BACKGROUND = 'BACKGROUND',
    OFFSCREEN_DOCUMENT = 'OFFSCREEN_DOCUMENT',
    SIDE_PANEL = 'SIDE_PANEL'
  }

  export enum OnInstalledReason {
    INSTALL = 'install',
    UPDATE = 'update',
    CHROME_UPDATE = 'chrome_update',
    SHARED_MODULE_UPDATE = 'shared_module_update'
  }

  export interface LastError {
    message?: string | undefined
  }

  export interface ContextFilter {
    contextIds?: string[] | undefined
    contextTypes?: ContextType[] | undefined
    documentIds?: string[] | undefined
    documentOrigins?: string[] | undefined
    documentUrls?: string[] | undefined
    frameIds?: number[] | undefined
    incognito?: boolean | undefined
    tabIds?: number[] | undefined
    windowIds?: number[] | undefined
  }

  export interface ConnectInfo {
    name?: string | undefined
    includeTlsChannelId?: boolean | undefined
  }

  export interface InstalledDetails {
    reason: OnInstalledReason

    previousVersion?: string | undefined

    id?: string | undefined
  }

  export interface ExtensionContext {
    contextId: string

    contextType: ContextType

    documentId?: string | undefined

    documentOrigin?: string | undefined

    documentUrl?: string | undefined

    frameId: number

    incognito: boolean

    tabId: number

    windowId: number
  }

  export interface MessageOptions {
    includeTlsChannelId?: boolean | undefined
  }

  export interface MessageSender {
    id?: string | undefined

    tab?: chrome.tabs.Tab | undefined

    nativeApplication?: string | undefined

    frameId?: number | undefined

    url?: string | undefined

    tlsChannelId?: string | undefined

    origin?: string | undefined

    documentLifecycle?: DocumentLifecycle | undefined

    documentId?: string | undefined
  }

  export interface PlatformInfo {
    os: PlatformOs

    arch: PlatformArch

    nacl_arch: PlatformNaclArch
  }

  export interface Port {
    postMessage: (message: any) => void
    disconnect: () => void

    sender?: MessageSender | undefined

    onDisconnect: PortDisconnectEvent

    onMessage: PortMessageEvent
    name: string
  }

  export interface UpdateAvailableDetails {
    version: string
  }

  export interface UpdateCheckDetails {
    version: string
  }

  export type RequestUpdateCheckStatus =
    | 'throttled'
    | 'no_update'
    | 'update_available'

  export interface RequestUpdateCheckResult {
    status: RequestUpdateCheckStatus

    version: string
  }

  export interface PortDisconnectEvent
    extends chrome.events.Event<(port: Port) => void> {}

  export interface PortMessageEvent
    extends chrome.events.Event<(message: any, port: Port) => void> {}

  export interface ExtensionMessageEvent
    extends chrome.events.Event<
      (
        message: any,
        sender: MessageSender,
        sendResponse: (response?: any) => void
      ) => void
    > {}

  export interface ExtensionConnectEvent
    extends chrome.events.Event<(port: Port) => void> {}

  export interface RuntimeInstalledEvent
    extends chrome.events.Event<(details: InstalledDetails) => void> {}

  export interface RuntimeEvent extends chrome.events.Event<() => void> {}

  export interface RuntimeRestartRequiredEvent
    extends chrome.events.Event<(reason: string) => void> {}

  export interface RuntimeUpdateAvailableEvent
    extends chrome.events.Event<(details: UpdateAvailableDetails) => void> {}

  export interface ManifestIcons {
    [size: number]: string
  }

  export interface ManifestAction {
    default_icon?: ManifestIcons | undefined
    default_title?: string | undefined
    default_popup?: string | undefined
  }

  export type ManifestPermissions =
    | 'activeTab'
    | 'alarms'
    | 'background'
    | 'bookmarks'
    | 'browsingData'
    | 'certificateProvider'
    | 'clipboardRead'
    | 'clipboardWrite'
    | 'contentSettings'
    | 'contextMenus'
    | 'cookies'
    | 'debugger'
    | 'declarativeContent'
    | 'declarativeNetRequest'
    | 'declarativeNetRequestFeedback'
    | 'declarativeNetRequestWithHostAccess'
    | 'declarativeWebRequest'
    | 'desktopCapture'
    | 'documentScan'
    | 'downloads'
    | 'downloads.shelf'
    | 'downloads.ui'
    | 'enterprise.deviceAttributes'
    | 'enterprise.hardwarePlatform'
    | 'enterprise.networkingAttributes'
    | 'enterprise.platformKeys'
    | 'experimental'
    | 'favicon'
    | 'fileBrowserHandler'
    | 'fileSystemProvider'
    | 'fontSettings'
    | 'gcm'
    | 'geolocation'
    | 'history'
    | 'identity'
    | 'identity.email'
    | 'idle'
    | 'loginState'
    | 'management'
    | 'nativeMessaging'
    | 'notifications'
    | 'offscreen'
    | 'pageCapture'
    | 'platformKeys'
    | 'power'
    | 'printerProvider'
    | 'printing'
    | 'printingMetrics'
    | 'privacy'
    | 'processes'
    | 'proxy'
    | 'scripting'
    | 'search'
    | 'sessions'
    | 'sidePanel'
    | 'signedInDevices'
    | 'storage'
    | 'system.cpu'
    | 'system.display'
    | 'system.memory'
    | 'system.storage'
    | 'tabCapture'
    | 'tabGroups'
    | 'tabs'
    | 'topSites'
    | 'tts'
    | 'ttsEngine'
    | 'unlimitedStorage'
    | 'vpnProvider'
    | 'wallpaper'
    | 'webNavigation'
    | 'webRequest'
    | 'webRequestBlocking'

  export interface SearchProvider {
    name?: string | undefined
    keyword?: string | undefined
    favicon_url?: string | undefined
    search_url: string
    encoding?: string | undefined
    suggest_url?: string | undefined
    instant_url?: string | undefined
    image_url?: string | undefined
    search_url_post_params?: string | undefined
    suggest_url_post_params?: string | undefined
    instant_url_post_params?: string | undefined
    image_url_post_params?: string | undefined
    alternate_urls?: string[] | undefined
    prepopulated_id?: number | undefined
    is_default?: boolean | undefined
  }

  export interface ManifestBase {
    manifest_version: number
    name: string
    version: string

    default_locale?: string | undefined
    description?: string | undefined
    icons?: ManifestIcons | undefined

    author?:
      | {
          email: string
        }
      | undefined
    background_page?: string | undefined
    chrome_settings_overrides?:
      | {
          homepage?: string | undefined
          search_provider?: SearchProvider | undefined
          startup_pages?: string[] | undefined
        }
      | undefined
    chrome_ui_overrides?:
      | {
          bookmarks_ui?:
            | {
                remove_bookmark_shortcut?: boolean | undefined
                remove_button?: boolean | undefined
              }
            | undefined
        }
      | undefined
    chrome_url_overrides?:
      | {
          bookmarks?: string | undefined
          history?: string | undefined
          newtab?: string | undefined
        }
      | undefined
    commands?:
      | {
          [name: string]: {
            suggested_key?:
              | {
                  default?: string | undefined
                  windows?: string | undefined
                  mac?: string | undefined
                  chromeos?: string | undefined
                  linux?: string | undefined
                }
              | undefined
            description?: string | undefined
            global?: boolean | undefined
          }
        }
      | undefined
    content_capabilities?:
      | {
          matches?: string[] | undefined
          permissions?: string[] | undefined
        }
      | undefined
    content_scripts?:
      | Array<{
          matches?: string[] | undefined
          exclude_matches?: string[] | undefined
          css?: string[] | undefined
          js?: string[] | undefined
          run_at?: string | undefined
          all_frames?: boolean | undefined
          match_about_blank?: boolean | undefined
          include_globs?: string[] | undefined
          exclude_globs?: string[] | undefined
        }>
      | undefined
    converted_from_user_script?: boolean | undefined
    current_locale?: string | undefined
    devtools_page?: string | undefined
    event_rules?:
      | Array<{
          event?: string | undefined
          actions?:
            | Array<{
                type: string
              }>
            | undefined
          conditions?:
            | chrome.declarativeContent.PageStateMatcherProperties[]
            | undefined
        }>
      | undefined
    externally_connectable?:
      | {
          ids?: string[] | undefined
          matches?: string[] | undefined
          accepts_tls_channel_id?: boolean | undefined
        }
      | undefined
    file_browser_handlers?:
      | Array<{
          id?: string | undefined
          default_title?: string | undefined
          file_filters?: string[] | undefined
        }>
      | undefined
    file_system_provider_capabilities?:
      | {
          configurable?: boolean | undefined
          watchable?: boolean | undefined
          multiple_mounts?: boolean | undefined
          source?: string | undefined
        }
      | undefined
    homepage_url?: string | undefined
    import?:
      | Array<{
          id: string
          minimum_version?: string | undefined
        }>
      | undefined
    export?:
      | {
          whitelist?: string[] | undefined
        }
      | undefined
    incognito?: string | undefined
    input_components?:
      | Array<{
          name?: string | undefined
          type?: string | undefined
          id?: string | undefined
          description?: string | undefined
          language?: string[] | string | undefined
          layouts?: string[] | undefined
          indicator?: string | undefined
        }>
      | undefined
    key?: string | undefined
    minimum_chrome_version?: string | undefined
    nacl_modules?:
      | Array<{
          path: string
          mime_type: string
        }>
      | undefined
    oauth2?:
      | {
          client_id: string
          scopes?: string[] | undefined
        }
      | undefined
    offline_enabled?: boolean | undefined
    omnibox?:
      | {
          keyword: string
        }
      | undefined
    options_page?: string | undefined
    options_ui?:
      | {
          page?: string | undefined
          chrome_style?: boolean | undefined
          open_in_tab?: boolean | undefined
        }
      | undefined
    platforms?:
      | Array<{
          nacl_arch?: string | undefined
          sub_package_path: string
        }>
      | undefined
    plugins?:
      | Array<{
          path: string
        }>
      | undefined
    requirements?:
      | {
          '3D'?:
            | {
                features?: string[] | undefined
              }
            | undefined
          plugins?:
            | {
                npapi?: boolean | undefined
              }
            | undefined
        }
      | undefined
    sandbox?:
      | {
          pages: string[]
          content_security_policy?: string | undefined
        }
      | undefined
    short_name?: string | undefined
    spellcheck?:
      | {
          dictionary_language?: string | undefined
          dictionary_locale?: string | undefined
          dictionary_format?: string | undefined
          dictionary_path?: string | undefined
        }
      | undefined
    storage?:
      | {
          managed_schema: string
        }
      | undefined
    tts_engine?:
      | {
          voices: Array<{
            voice_name: string
            lang?: string | undefined
            gender?: string | undefined
            event_types?: string[] | undefined
          }>
        }
      | undefined
    update_url?: string | undefined
    version_name?: string | undefined
    [key: string]: any
  }

  export interface ManifestV2 extends ManifestBase {
    manifest_version: 2

    browser_action?: ManifestAction | undefined
    page_action?: ManifestAction | undefined

    background?:
      | {
          scripts?: string[] | undefined
          page?: string | undefined
          persistent?: boolean | undefined
        }
      | undefined
    content_security_policy?: string | undefined
    optional_permissions?: string[] | undefined
    permissions?: string[] | undefined
    web_accessible_resources?: string[] | undefined
  }

  export interface ManifestV3 extends ManifestBase {
    manifest_version: 3

    action?: ManifestAction | undefined
    background?:
      | {
          service_worker: string
          type?: 'module'
        }
      | undefined
    content_scripts?:
      | Array<{
          matches?: string[] | undefined
          exclude_matches?: string[] | undefined
          css?: string[] | undefined
          js?: string[] | undefined
          run_at?: string | undefined
          all_frames?: boolean | undefined
          match_about_blank?: boolean | undefined
          include_globs?: string[] | undefined
          exclude_globs?: string[] | undefined
          world?: 'ISOLATED' | 'MAIN' | undefined
        }>
      | undefined
    content_security_policy?: {
      extension_pages?: string
      sandbox?: string
    }
    host_permissions?: string[] | undefined
    optional_permissions?: ManifestPermissions[] | undefined
    permissions?: ManifestPermissions[] | undefined
    web_accessible_resources?:
      | Array<{resources: string[]; matches: string[]}>
      | undefined
  }

  export type Manifest = ManifestV2 | ManifestV3

  export function connect(connectInfo?: ConnectInfo): Port

  export function connect(extensionId: string, connectInfo?: ConnectInfo): Port

  export function connectNative(application: string): Port

  export function getBackgroundPage(
    callback: (backgroundPage?: Window) => void
  ): void

  export function getContexts(
    filter: ContextFilter
  ): Promise<ExtensionContext[]>

  export function getContexts(
    filter: ContextFilter,
    callback: (contexts: ExtensionContext[]) => void
  ): void

  export function getManifest(): Manifest

  export function getPackageDirectoryEntry(
    callback: (directoryEntry: DirectoryEntry) => void
  ): void

  export function getPlatformInfo(
    callback: (platformInfo: PlatformInfo) => void
  ): void

  export function getPlatformInfo(): Promise<PlatformInfo>

  export function getURL(path: string): string

  export function reload(): void

  export function requestUpdateCheck(): Promise<RequestUpdateCheckResult>

  export function requestUpdateCheck(
    callback: (
      status: RequestUpdateCheckStatus,
      details?: UpdateCheckDetails
    ) => void
  ): void

  export function restart(): void

  export function restartAfterDelay(
    seconds: number,
    callback?: () => void
  ): void

  export function sendMessage<M = any, R = any>(
    message: M,
    responseCallback: (response: R) => void
  ): void

  export function sendMessage<M = any, R = any>(
    message: M,
    options: MessageOptions,
    responseCallback: (response: R) => void
  ): void

  export function sendMessage<M = any, R = any>(
    extensionId: string | undefined | null,
    message: M,
    responseCallback: (response: R) => void
  ): void

  export function sendMessage<Message = any, Response = any>(
    extensionId: string | undefined | null,
    message: Message,
    options: MessageOptions,
    responseCallback: (response: Response) => void
  ): void

  export function sendMessage<M = any, R = any>(message: M): Promise<R>

  export function sendMessage<M = any, R = any>(
    message: M,
    options: MessageOptions
  ): Promise<R>

  export function sendMessage<M = any, R = any>(
    extensionId: string | undefined | null,
    message: M
  ): Promise<R>

  export function sendMessage<Message = any, Response = any>(
    extensionId: string | undefined | null,
    message: Message,
    options: MessageOptions
  ): Promise<Response>

  export function sendNativeMessage(
    application: string,
    message: Object,
    responseCallback: (response: any) => void
  ): void

  export function sendNativeMessage(
    application: string,
    message: Object
  ): Promise<any>

  export function setUninstallURL(url: string, callback?: () => void): void

  export function openOptionsPage(callback?: () => void): void

  export var onConnect: ExtensionConnectEvent

  export var onConnectExternal: ExtensionConnectEvent

  export var onSuspend: RuntimeEvent

  export var onStartup: RuntimeEvent

  export var onInstalled: RuntimeInstalledEvent

  export var onSuspendCanceled: RuntimeEvent

  export var onMessage: ExtensionMessageEvent

  export var onMessageExternal: ExtensionMessageEvent

  export var onRestartRequired: RuntimeRestartRequiredEvent

  export var onUpdateAvailable: RuntimeUpdateAvailableEvent

  export var onBrowserUpdateAvailable: RuntimeEvent
}

declare namespace chrome.scripting {
  export type StyleOrigin = 'AUTHOR' | 'USER'

  export type ExecutionWorld = 'ISOLATED' | 'MAIN'

  export interface InjectionResult<T> {
    frameId: number

    result: T
  }

  export interface InjectionTarget {
    allFrames?: boolean | undefined

    frameIds?: number[] | undefined

    tabId: number
  }

  export interface CSSInjection {
    css?: string | undefined

    files?: string[] | undefined

    origin?: StyleOrigin | undefined

    target: InjectionTarget
  }

  export type ScriptInjection<Args extends any[], Result> = {
    target: InjectionTarget

    world?: ExecutionWorld

    injectImmediately?: boolean
  } & (
    | {
        files: string[]
      }
    | (
        | {
            func: () => Result
          }
        | {
            func: (...args: Args) => Result

            args: Args
          }
      )
  )

  type Awaited<T> = T extends PromiseLike<infer U> ? U : T

  interface RegisteredContentScript {
    id: string
    allFrames?: boolean
    matchOriginAsFallback?: boolean
    css?: string[]
    excludeMatches?: string[]
    js?: string[]
    matches?: string[]
    persistAcrossSessions?: boolean
    runAt?: 'document_start' | 'document_end' | 'document_idle'
    world?: ExecutionWorld
  }

  interface ContentScriptFilter {
    ids?: string[]
    css?: string
    files?: string[]
    origin?: StyleOrigin
    target?: InjectionTarget
  }

  export function executeScript<Args extends any[], Result>(
    injection: ScriptInjection<Args, Result>
  ): Promise<Array<InjectionResult<Awaited<Result>>>>

  export function executeScript<Args extends any[], Result>(
    injection: ScriptInjection<Args, Result>,
    callback: (results: Array<InjectionResult<Awaited<Result>>>) => void
  ): void

  export function insertCSS(injection: CSSInjection): Promise<void>

  export function insertCSS(injection: CSSInjection, callback: () => void): void

  export function removeCSS(injection: CSSInjection): Promise<void>

  export function removeCSS(injection: CSSInjection, callback: () => void): void

  export function registerContentScripts(
    scripts: RegisteredContentScript[]
  ): Promise<void>

  export function registerContentScripts(
    scripts: RegisteredContentScript[],
    callback: () => void
  ): void

  export function unregisterContentScripts(
    filter?: ContentScriptFilter
  ): Promise<void>

  export function unregisterContentScripts(callback: () => void): void
  export function unregisterContentScripts(
    filter: ContentScriptFilter,
    callback: () => void
  ): void

  export function getRegisteredContentScripts(
    filter?: ContentScriptFilter
  ): Promise<RegisteredContentScript[]>

  export function getRegisteredContentScripts(
    callback: (scripts: RegisteredContentScript[]) => void
  ): void
  export function getRegisteredContentScripts(
    filter: ContentScriptFilter,
    callback: (scripts: RegisteredContentScript[]) => void
  ): void

  export function updateContentScripts(
    scripts: RegisteredContentScript[]
  ): Promise<void>

  export function updateContentScripts(
    scripts: RegisteredContentScript[],
    callback: () => void
  ): void
}

declare namespace chrome.scriptBadge {
  export interface GetPopupDetails {
    tabId: number
  }

  export interface AttentionDetails {
    tabId: number
  }

  export interface SetPopupDetails {
    tabId: number
    popup: string
  }

  export interface ScriptBadgeClickedEvent
    extends chrome.events.Event<(tab: chrome.tabs.Tab) => void> {}

  export function getPopup(details: GetPopupDetails, callback: Function): void
  export function getAttention(details: AttentionDetails): void
  export function setPopup(details: SetPopupDetails): void

  export var onClicked: ScriptBadgeClickedEvent
}

declare namespace chrome.sessions {
  export interface Filter {
    maxResults?: number | undefined
  }

  export interface Session {
    lastModified: number

    tab?: tabs.Tab | undefined

    window?: windows.Window | undefined
  }

  export interface Device {
    deviceName: string

    sessions: Session[]
  }

  export interface SessionChangedEvent
    extends chrome.events.Event<() => void> {}

  export var MAX_SESSION_RESULTS: number

  export function getRecentlyClosed(filter?: Filter): Promise<Session[]>

  export function getRecentlyClosed(
    filter: Filter,
    callback: (sessions: Session[]) => void
  ): void

  export function getRecentlyClosed(
    callback: (sessions: Session[]) => void
  ): void

  export function getDevices(filter?: Filter): Promise<Device[]>

  export function getDevices(
    filter: Filter,
    callback: (devices: Device[]) => void
  ): void

  export function getDevices(callback: (devices: Device[]) => void): void

  export function restore(sessionId?: string): Promise<Session>

  export function restore(
    sessionId: string,
    callback: (restoredSession: Session) => void
  ): void

  export function restore(callback: (restoredSession: Session) => void): void

  export var onChanged: SessionChangedEvent
}

declare namespace chrome.storage {
  export interface StorageArea {
    getBytesInUse(callback: (bytesInUse: number) => void): void

    getBytesInUse(keys?: string | string[] | null): Promise<number>

    getBytesInUse(
      keys: string | string[] | null,
      callback: (bytesInUse: number) => void
    ): void

    clear(): Promise<void>

    clear(callback: () => void): void

    set(items: {[key: string]: any}): Promise<void>

    set(items: {[key: string]: any}, callback: () => void): void

    remove(keys: string | string[]): Promise<void>

    remove(keys: string | string[], callback: () => void): void

    get(callback: (items: {[key: string]: any}) => void): void

    get(
      keys?: string | string[] | {[key: string]: any} | null
    ): Promise<{[key: string]: any}>

    get(
      keys: string | string[] | {[key: string]: any} | null,
      callback: (items: {[key: string]: any}) => void
    ): void

    setAccessLevel(accessOptions: {accessLevel: AccessLevel}): Promise<void>

    setAccessLevel(
      accessOptions: {accessLevel: AccessLevel},
      callback: () => void
    ): void

    onChanged: StorageAreaChangedEvent
  }

  export interface StorageChange {
    newValue?: any

    oldValue?: any
  }

  export interface LocalStorageArea extends StorageArea {
    QUOTA_BYTES: number
  }

  export interface SyncStorageArea extends StorageArea {
    MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE: number

    QUOTA_BYTES: number

    QUOTA_BYTES_PER_ITEM: number

    MAX_ITEMS: number

    MAX_WRITE_OPERATIONS_PER_HOUR: number

    MAX_WRITE_OPERATIONS_PER_MINUTE: number
  }

  export interface SessionStorageArea extends StorageArea {
    QUOTA_BYTES: number
  }

  export interface StorageAreaChangedEvent
    extends chrome.events.Event<
      (changes: {[key: string]: StorageChange}) => void
    > {}

  type AreaName = keyof Pick<
    typeof chrome.storage,
    'sync' | 'local' | 'managed' | 'session'
  >
  export interface StorageChangedEvent
    extends chrome.events.Event<
      (changes: {[key: string]: StorageChange}, areaName: AreaName) => void
    > {}

  type AccessLevel = keyof typeof AccessLevel

  export var AccessLevel: {
    TRUSTED_AND_UNTRUSTED_CONTEXTS: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
    TRUSTED_CONTEXTS: 'TRUSTED_CONTEXTS'
  }

  export var local: LocalStorageArea

  export var sync: SyncStorageArea

  export var managed: StorageArea

  export var session: SessionStorageArea

  export var onChanged: StorageChangedEvent
}

declare namespace chrome.socket {
  export interface CreateInfo {
    socketId: number
  }

  export interface AcceptInfo {
    resultCode: number
    socketId?: number | undefined
  }

  export interface ReadInfo {
    resultCode: number
    data: ArrayBuffer
  }

  export interface WriteInfo {
    bytesWritten: number
  }

  export interface RecvFromInfo {
    resultCode: number
    data: ArrayBuffer
    port: number
    address: string
  }

  export interface SocketInfo {
    socketType: string
    localPort?: number | undefined
    peerAddress?: string | undefined
    peerPort?: number | undefined
    localAddress?: string | undefined
    connected: boolean
  }

  export interface NetworkInterface {
    name: string
    address: string
  }

  export function create(
    type: string,
    options?: Object,
    callback?: (createInfo: CreateInfo) => void
  ): void
  export function destroy(socketId: number): void
  export function connect(
    socketId: number,
    hostname: string,
    port: number,
    callback: (result: number) => void
  ): void
  export function bind(
    socketId: number,
    address: string,
    port: number,
    callback: (result: number) => void
  ): void
  export function disconnect(socketId: number): void
  export function read(
    socketId: number,
    bufferSize?: number,
    callback?: (readInfo: ReadInfo) => void
  ): void
  export function write(
    socketId: number,
    data: ArrayBuffer,
    callback?: (writeInfo: WriteInfo) => void
  ): void
  export function recvFrom(
    socketId: number,
    bufferSize?: number,
    callback?: (recvFromInfo: RecvFromInfo) => void
  ): void
  export function sendTo(
    socketId: number,
    data: ArrayBuffer,
    address: string,
    port: number,
    callback?: (writeInfo: WriteInfo) => void
  ): void
  export function listen(
    socketId: number,
    address: string,
    port: number,
    backlog?: number,
    callback?: (result: number) => void
  ): void
  export function accept(
    socketId: number,
    callback?: (acceptInfo: AcceptInfo) => void
  ): void
  export function setKeepAlive(
    socketId: number,
    enable: boolean,
    delay?: number,
    callback?: (result: boolean) => void
  ): void
  export function setNoDelay(
    socketId: number,
    noDelay: boolean,
    callback?: (result: boolean) => void
  ): void
  export function getInfo(
    socketId: number,
    callback: (result: SocketInfo) => void
  ): void
  export function getNetworkList(
    callback: (result: NetworkInterface[]) => void
  ): void
}

declare namespace chrome.system.cpu {
  export interface ProcessorUsage {
    user: number

    kernel: number

    idle: number

    total: number
  }

  export interface ProcessorInfo {
    usage: ProcessorUsage
  }

  export interface CpuInfo {
    numOfProcessors: number

    archName: string

    modelName: string

    features: string[]

    processors: ProcessorInfo[]
  }

  export function getInfo(callback: (info: CpuInfo) => void): void

  export function getInfo(): Promise<CpuInfo>
}

declare namespace chrome.system.memory {
  export interface MemoryInfo {
    capacity: number

    availableCapacity: number
  }

  export function getInfo(callback: (info: MemoryInfo) => void): void

  export function getInfo(): Promise<MemoryInfo>
}

declare namespace chrome.system.storage {
  export interface StorageUnitInfo {
    id: string

    name: string

    type: string

    capacity: number
  }

  export interface StorageCapacityInfo {
    id: string

    availableCapacity: number
  }

  export interface SystemStorageAttachedEvent
    extends chrome.events.Event<(info: StorageUnitInfo) => void> {}

  export interface SystemStorageDetachedEvent
    extends chrome.events.Event<(id: string) => void> {}

  export function getInfo(callback: (info: StorageUnitInfo[]) => void): void

  export function getInfo(): Promise<StorageUnitInfo[]>

  export function ejectDevice(
    id: string,
    callback: (result: string) => void
  ): void

  export function ejectDevice(id: string): Promise<string>

  export function getAvailableCapacity(
    id: string,
    callback: (info: StorageCapacityInfo) => void
  ): void

  export function getAvailableCapacity(id: string): Promise<StorageCapacityInfo>

  export var onAttached: SystemStorageAttachedEvent

  export var onDetached: SystemStorageDetachedEvent
}

declare namespace chrome.system.display {
  export const DisplayPosition: {
    TOP: 'top'
    RIGHT: 'right'
    BOTTOM: 'bottom'
    LEFT: 'left'
  }
  export const MirrorMode: {
    OFF: 'off'
    NORMAL: 'normal'
    MIXED: 'mixed'
  }
  export interface Bounds {
    left: number

    top: number

    width: number

    height: number
  }

  export interface Insets {
    left: number

    top: number

    right: number

    bottom: number
  }

  export interface Point {
    x: number

    y: number
  }

  export interface TouchCalibrationPair {
    displayPoint: Point

    touchPoint: Point
  }

  export interface DisplayMode {
    width: number

    height: number

    widthInNativePixels: number

    heightInNativePixels: number

    uiScale: number

    deviceScaleFactor: number

    refreshRate: number

    isNative: boolean

    isSelected: boolean
  }

  export interface DisplayLayout {
    id: string

    parentId: string

    position: (typeof DisplayPosition)[keyof typeof DisplayPosition]

    offset: number
  }

  export interface TouchCalibrationPairs {
    pair1: TouchCalibrationPair

    pair2: TouchCalibrationPair

    pair3: TouchCalibrationPair

    pair4: TouchCalibrationPair
  }

  export interface DisplayPropertiesInfo {
    isUnified?: boolean | undefined

    mirroringSourceId?: string | undefined

    isPrimary?: boolean | undefined

    overscan?: Insets | undefined

    rotation?: 0 | 90 | 180 | 270 | undefined

    boundsOriginX?: number | undefined

    boundsOriginY?: number | undefined

    displayMode?: DisplayMode | undefined

    displayZoomFactor?: number | undefined
  }

  export interface DisplayInfoFlags {
    singleUnified?: boolean | undefined
  }

  export interface DisplayInfo {
    id: string

    name: string

    edid?:
      | {
          manufacturerId: string

          productId: string

          yearOfManufacture?: string | undefined
        }
      | undefined

    mirroringSourceId: string

    mirroringDestinationIds: string[]

    isPrimary: boolean

    isInternal: boolean

    isEnabled: boolean

    dpiX: number

    dpiY: number

    rotation: number

    bounds: Bounds

    overscan: Insets

    workArea: Bounds

    modes: DisplayMode[]

    hasTouchSupport: boolean

    availableDisplayZoomFactors: number[]

    displayZoomFactor: number
  }

  export interface MirrorModeInfo {
    mode?: 'off' | 'normal' | 'mixed' | undefined
  }
  export interface MirrorModeInfoMixed extends MirrorModeInfo {
    mode: 'mixed'
    mirroringSourceId?: string | undefined

    mirroringDestinationIds?: string[] | undefined
  }

  export function getInfo(callback: (info: DisplayInfo[]) => void): void

  export function getInfo(): Promise<DisplayInfo[]>

  export function getInfo(
    flags: DisplayInfoFlags,
    callback: (info: DisplayInfo[]) => void
  ): void

  export function getInfo(flags: DisplayInfoFlags): Promise<DisplayInfo[]>

  export function getDisplayLayout(
    callback: (layouts: DisplayLayout[]) => void
  ): void

  export function getDisplayLayout(): Promise<DisplayLayout[]>

  export function setDisplayProperties(
    id: string,
    info: DisplayPropertiesInfo
  ): Promise<void>

  export function setDisplayProperties(
    id: string,
    info: DisplayPropertiesInfo,
    callback: () => void
  ): void

  export function setDisplayLayout(layouts: DisplayLayout[]): Promise<void>

  export function setDisplayLayout(
    layouts: DisplayLayout[],
    callback: () => void
  ): void

  export function enableUnifiedDesktop(enabled: boolean): void

  export function overscanCalibrationStart(id: string): void

  export function overscanCalibrationAdjust(id: string, delta: Insets): void

  export function overscanCalibrationReset(id: string): void

  export function overscanCalibrationComplete(id: string): void

  export function showNativeTouchCalibration(
    id: string,
    callback: (success: boolean) => void
  ): void

  export function showNativeTouchCalibration(id: string): Promise<boolean>

  export function startCustomTouchCalibration(id: string): void

  export function completeCustomTouchCalibration(
    pairs: TouchCalibrationPairs,
    bounds: Bounds
  ): void

  export function clearTouchCalibration(id: string): void

  export function setMirrorMode(
    info: MirrorModeInfo | MirrorModeInfoMixed,
    callback: () => void
  ): void

  export function setMirrorMode(
    info: MirrorModeInfo | MirrorModeInfoMixed
  ): Promise<void>

  export const onDisplayChanged: chrome.events.Event<() => void>
}

declare namespace chrome.tabCapture {
  export interface CaptureInfo {
    tabId: number

    status: string

    fullscreen: boolean
  }

  export interface MediaStreamConstraint {
    mandatory: object
    optional?: object | undefined
  }

  export interface CaptureOptions {
    audio?: boolean | undefined

    video?: boolean | undefined

    audioConstraints?: MediaStreamConstraint | undefined

    videoConstraints?: MediaStreamConstraint | undefined
  }

  export interface GetMediaStreamOptions {
    consumerTabId?: number | undefined

    targetTabId?: number | undefined
  }

  export interface CaptureStatusChangedEvent
    extends chrome.events.Event<(info: CaptureInfo) => void> {}

  export function capture(
    options: CaptureOptions,
    callback: (stream: MediaStream | null) => void
  ): void

  export function getCapturedTabs(
    callback: (result: CaptureInfo[]) => void
  ): void

  export function getMediaStreamId(
    options: GetMediaStreamOptions,
    callback: (streamId: string) => void
  ): void

  export var onStatusChanged: CaptureStatusChangedEvent
}

declare namespace chrome.tabs {
  export interface MutedInfo {
    muted: boolean

    reason?: string | undefined

    extensionId?: string | undefined
  }

  export interface Tab {
    status?: string | undefined

    index: number

    openerTabId?: number | undefined

    title?: string | undefined

    url?: string | undefined

    pendingUrl?: string | undefined

    pinned: boolean

    highlighted: boolean

    windowId: number

    active: boolean

    favIconUrl?: string | undefined

    id?: number | undefined

    incognito: boolean

    selected: boolean

    audible?: boolean | undefined

    discarded: boolean

    autoDiscardable: boolean

    mutedInfo?: MutedInfo | undefined

    width?: number | undefined

    height?: number | undefined

    sessionId?: string | undefined

    groupId: number
  }

  export interface ZoomSettings {
    mode?: string | undefined

    scope?: string | undefined

    defaultZoomFactor?: number | undefined
  }

  export interface InjectDetails {
    allFrames?: boolean | undefined

    code?: string | undefined

    runAt?: string | undefined

    file?: string | undefined

    frameId?: number | undefined

    matchAboutBlank?: boolean | undefined

    cssOrigin?: string | undefined
  }

  export interface CreateProperties {
    index?: number | undefined

    openerTabId?: number | undefined

    url?: string | undefined

    pinned?: boolean | undefined

    windowId?: number | undefined

    active?: boolean | undefined

    selected?: boolean | undefined
  }

  export interface MoveProperties {
    index: number

    windowId?: number | undefined
  }

  export interface UpdateProperties {
    pinned?: boolean | undefined

    openerTabId?: number | undefined

    url?: string | undefined

    highlighted?: boolean | undefined

    active?: boolean | undefined

    selected?: boolean | undefined

    muted?: boolean | undefined

    autoDiscardable?: boolean | undefined
  }

  export interface CaptureVisibleTabOptions {
    quality?: number | undefined

    format?: string | undefined
  }

  export interface ReloadProperties {
    bypassCache?: boolean | undefined
  }

  export interface ConnectInfo {
    name?: string | undefined

    frameId?: number | undefined

    documentId?: string
  }

  export interface MessageSendOptions {
    frameId?: number | undefined

    documentId?: string
  }

  export interface GroupOptions {
    createProperties?:
      | {
          windowId?: number | undefined
        }
      | undefined

    groupId?: number | undefined

    tabIds?: number | number[] | undefined
  }

  export interface HighlightInfo {
    tabs: number | number[]

    windowId?: number | undefined
  }

  export interface QueryInfo {
    status?: 'loading' | 'complete' | undefined

    lastFocusedWindow?: boolean | undefined

    windowId?: number | undefined

    windowType?: 'normal' | 'popup' | 'panel' | 'app' | 'devtools' | undefined

    active?: boolean | undefined

    index?: number | undefined

    title?: string | undefined

    url?: string | string[] | undefined

    currentWindow?: boolean | undefined

    highlighted?: boolean | undefined

    discarded?: boolean | undefined

    autoDiscardable?: boolean | undefined

    pinned?: boolean | undefined

    audible?: boolean | undefined

    muted?: boolean | undefined

    groupId?: number | undefined
  }

  export interface TabHighlightInfo {
    windowId: number
    tabIds: number[]
  }

  export interface TabRemoveInfo {
    windowId: number

    isWindowClosing: boolean
  }

  export interface TabAttachInfo {
    newPosition: number
    newWindowId: number
  }

  export interface TabChangeInfo {
    status?: string | undefined

    pinned?: boolean | undefined

    url?: string | undefined

    audible?: boolean | undefined

    discarded?: boolean | undefined

    autoDiscardable?: boolean | undefined

    groupId?: number | undefined

    mutedInfo?: MutedInfo | undefined

    favIconUrl?: string | undefined

    title?: string | undefined
  }

  export interface TabMoveInfo {
    toIndex: number
    windowId: number
    fromIndex: number
  }

  export interface TabDetachInfo {
    oldWindowId: number
    oldPosition: number
  }

  export interface TabActiveInfo {
    tabId: number

    windowId: number
  }

  export interface TabWindowInfo {
    windowId: number
  }

  export interface ZoomChangeInfo {
    tabId: number
    oldZoomFactor: number
    newZoomFactor: number
    zoomSettings: ZoomSettings
  }

  export interface TabHighlightedEvent
    extends chrome.events.Event<(highlightInfo: TabHighlightInfo) => void> {}

  export interface TabRemovedEvent
    extends chrome.events.Event<
      (tabId: number, removeInfo: TabRemoveInfo) => void
    > {}

  export interface TabUpdatedEvent
    extends chrome.events.Event<
      (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void
    > {}

  export interface TabAttachedEvent
    extends chrome.events.Event<
      (tabId: number, attachInfo: TabAttachInfo) => void
    > {}

  export interface TabMovedEvent
    extends chrome.events.Event<
      (tabId: number, moveInfo: TabMoveInfo) => void
    > {}

  export interface TabDetachedEvent
    extends chrome.events.Event<
      (tabId: number, detachInfo: TabDetachInfo) => void
    > {}

  export interface TabCreatedEvent
    extends chrome.events.Event<(tab: Tab) => void> {}

  export interface TabActivatedEvent
    extends chrome.events.Event<(activeInfo: TabActiveInfo) => void> {}

  export interface TabReplacedEvent
    extends chrome.events.Event<
      (addedTabId: number, removedTabId: number) => void
    > {}

  export interface TabSelectedEvent
    extends chrome.events.Event<
      (tabId: number, selectInfo: TabWindowInfo) => void
    > {}

  export interface TabZoomChangeEvent
    extends chrome.events.Event<(ZoomChangeInfo: ZoomChangeInfo) => void> {}

  export function executeScript(details: InjectDetails): Promise<any[]>

  export function executeScript(
    details: InjectDetails,
    callback?: (result: any[]) => void
  ): void

  export function executeScript(
    tabId: number,
    details: InjectDetails
  ): Promise<any[]>

  export function executeScript(
    tabId: number,
    details: InjectDetails,
    callback?: (result: any[]) => void
  ): void

  export function get(tabId: number, callback: (tab: Tab) => void): void

  export function get(tabId: number): Promise<Tab>

  export function getAllInWindow(callback: (tab: Tab) => void): void

  export function getAllInWindow(): Promise<Tab>

  export function getAllInWindow(
    windowId: number,
    callback: (tab: Tab) => void
  ): void

  export function getAllInWindow(windowId: number): Promise<Tab>

  export function getCurrent(callback: (tab?: Tab) => void): void

  export function getCurrent(): Promise<Tab | undefined>

  export function getSelected(callback: (tab: Tab) => void): void

  export function getSelected(): Promise<Tab>

  export function getSelected(
    windowId: number,
    callback: (tab: Tab) => void
  ): void

  export function getSelected(windowId: number): Promise<Tab>

  export function create(createProperties: CreateProperties): Promise<Tab>

  export function create(
    createProperties: CreateProperties,
    callback: (tab: Tab) => void
  ): void

  export function move(
    tabId: number,
    moveProperties: MoveProperties
  ): Promise<Tab>

  export function move(
    tabId: number,
    moveProperties: MoveProperties,
    callback: (tab: Tab) => void
  ): void

  export function move(
    tabIds: number[],
    moveProperties: MoveProperties
  ): Promise<Tab[]>

  export function move(
    tabIds: number[],
    moveProperties: MoveProperties,
    callback: (tabs: Tab[]) => void
  ): void

  export function update(updateProperties: UpdateProperties): Promise<Tab>

  export function update(
    updateProperties: UpdateProperties,
    callback: (tab?: Tab) => void
  ): void

  export function update(
    tabId: number,
    updateProperties: UpdateProperties
  ): Promise<Tab>

  export function update(
    tabId: number,
    updateProperties: UpdateProperties,
    callback: (tab?: Tab) => void
  ): void

  export function remove(tabId: number): Promise<void>

  export function remove(tabId: number, callback: Function): void

  export function remove(tabIds: number[]): Promise<void>

  export function remove(tabIds: number[], callback: Function): void

  export function captureVisibleTab(callback: (dataUrl: string) => void): void

  export function captureVisibleTab(): Promise<string>

  export function captureVisibleTab(
    windowId: number,
    callback: (dataUrl: string) => void
  ): void

  export function captureVisibleTab(windowId: number): Promise<string>

  export function captureVisibleTab(
    options: CaptureVisibleTabOptions
  ): Promise<string>

  export function captureVisibleTab(
    options: CaptureVisibleTabOptions,
    callback: (dataUrl: string) => void
  ): void

  export function captureVisibleTab(
    windowId: number,
    options: CaptureVisibleTabOptions
  ): Promise<string>

  export function captureVisibleTab(
    windowId: number,
    options: CaptureVisibleTabOptions,
    callback: (dataUrl: string) => void
  ): void

  export function reload(
    tabId: number,
    reloadProperties?: ReloadProperties
  ): Promise<void>

  export function reload(
    tabId: number,
    reloadProperties?: ReloadProperties,
    callback?: () => void
  ): void

  export function reload(reloadProperties: ReloadProperties): Promise<void>

  export function reload(
    reloadProperties: ReloadProperties,
    callback: () => void
  ): void

  export function reload(): Promise<void>

  export function reload(callback: () => void): void

  export function duplicate(tabId: number): Promise<Tab | undefined>

  export function duplicate(tabId: number, callback: (tab?: Tab) => void): void

  export function sendMessage<M = any, R = any>(
    tabId: number,
    message: M,
    responseCallback: (response: R) => void
  ): void

  export function sendMessage<M = any, R = any>(
    tabId: number,
    message: M,
    options: MessageSendOptions,
    responseCallback: (response: R) => void
  ): void

  export function sendMessage<M = any, R = any>(
    tabId: number,
    message: M
  ): Promise<R>

  export function sendMessage<M = any, R = any>(
    tabId: number,
    message: M,
    options: MessageSendOptions
  ): Promise<R>

  export function sendRequest<Request = any, Response = any>(
    tabId: number,
    request: Request,
    responseCallback?: (response: Response) => void
  ): void

  export function connect(
    tabId: number,
    connectInfo?: ConnectInfo
  ): runtime.Port

  export function insertCSS(details: InjectDetails): Promise<void>

  export function insertCSS(details: InjectDetails, callback: Function): void

  export function insertCSS(
    tabId: number,
    details: InjectDetails
  ): Promise<void>

  export function insertCSS(
    tabId: number,
    details: InjectDetails,
    callback: Function
  ): void

  export function highlight(
    highlightInfo: HighlightInfo
  ): Promise<chrome.windows.Window>

  export function highlight(
    highlightInfo: HighlightInfo,
    callback: (window: chrome.windows.Window) => void
  ): void

  export function query(
    queryInfo: QueryInfo,
    callback: (result: Tab[]) => void
  ): void

  export function query(queryInfo: QueryInfo): Promise<Tab[]>

  export function detectLanguage(callback: (language: string) => void): void

  export function detectLanguage(): Promise<string>

  export function detectLanguage(
    tabId: number,
    callback: (language: string) => void
  ): void

  export function detectLanguage(tabId: number): Promise<string>

  export function setZoom(zoomFactor: number): Promise<void>

  export function setZoom(zoomFactor: number, callback: () => void): void

  export function setZoom(tabId: number, zoomFactor: number): Promise<void>

  export function setZoom(
    tabId: number,
    zoomFactor: number,
    callback: () => void
  ): void

  export function getZoom(callback: (zoomFactor: number) => void): void

  export function getZoom(): Promise<number>

  export function getZoom(
    tabId: number,
    callback: (zoomFactor: number) => void
  ): void

  export function getZoom(tabId: number): Promise<number>

  export function setZoomSettings(zoomSettings: ZoomSettings): Promise<void>

  export function setZoomSettings(
    zoomSettings: ZoomSettings,
    callback: () => void
  ): void

  export function setZoomSettings(
    tabId: number,
    zoomSettings: ZoomSettings
  ): Promise<void>

  export function setZoomSettings(
    tabId: number,
    zoomSettings: ZoomSettings,
    callback: () => void
  ): void

  export function getZoomSettings(
    callback: (zoomSettings: ZoomSettings) => void
  ): void

  export function getZoomSettings(): Promise<ZoomSettings>

  export function getZoomSettings(
    tabId: number,
    callback: (zoomSettings: ZoomSettings) => void
  ): void

  export function getZoomSettings(tabId: number): Promise<ZoomSettings>

  export function discard(tabId?: number): Promise<Tab>

  export function discard(callback: (tab: Tab) => void): void
  export function discard(tabId: number, callback: (tab: Tab) => void): void

  export function goForward(): Promise<void>

  export function goForward(callback: () => void): void

  export function goForward(tabId: number): Promise<void>

  export function goForward(tabId: number, callback: () => void): void

  export function goBack(): Promise<void>

  export function goBack(callback: () => void): void

  export function goBack(tabId: number): Promise<void>

  export function goBack(tabId: number, callback: () => void): void

  export function group(options: GroupOptions): Promise<number>

  export function group(options: GroupOptions): Promise<number>

  export function group(
    options: GroupOptions,
    callback: (groupId: number) => void
  ): void

  export function ungroup(tabIds: number | number[]): Promise<void>

  export function ungroup(tabIds: number | number[], callback: () => void): void

  export var onHighlighted: TabHighlightedEvent

  export var onRemoved: TabRemovedEvent

  export var onUpdated: TabUpdatedEvent

  export var onAttached: TabAttachedEvent

  export var onMoved: TabMovedEvent

  export var onDetached: TabDetachedEvent

  export var onCreated: TabCreatedEvent

  export var onActivated: TabActivatedEvent

  export var onReplaced: TabReplacedEvent

  export var onSelectionChanged: TabSelectedEvent

  export var onActiveChanged: TabSelectedEvent

  export var onHighlightChanged: TabHighlightedEvent

  export var onZoomChange: TabZoomChangeEvent

  export var TAB_ID_NONE: -1
}

declare namespace chrome.tabGroups {
  export var TAB_GROUP_ID_NONE: -1

  export type ColorEnum =
    | 'grey'
    | 'blue'
    | 'red'
    | 'yellow'
    | 'green'
    | 'pink'
    | 'purple'
    | 'cyan'
    | 'orange'

  export interface TabGroup {
    collapsed: boolean

    color: ColorEnum

    id: number

    title?: string | undefined

    windowId: number
  }

  export interface MoveProperties {
    index: number

    windowId?: number | undefined
  }

  export interface QueryInfo {
    collapsed?: boolean | undefined

    color?: ColorEnum | undefined

    title?: string | undefined

    windowId?: number | undefined
  }

  export interface UpdateProperties {
    collapsed?: boolean | undefined

    color?: ColorEnum | undefined

    title?: string | undefined
  }

  export function get(
    groupId: number,
    callback: (group: TabGroup) => void
  ): void

  export function get(groupId: number): Promise<TabGroup>

  export function move(
    groupId: number,
    moveProperties: MoveProperties
  ): Promise<TabGroup>

  export function move(
    groupId: number,
    moveProperties: MoveProperties,
    callback: (group: TabGroup) => void
  ): void

  export function query(
    queryInfo: QueryInfo,
    callback: (result: TabGroup[]) => void
  ): void

  export function query(queryInfo: QueryInfo): Promise<TabGroup[]>

  export function update(
    groupId: number,
    updateProperties: UpdateProperties
  ): Promise<TabGroup>

  export function update(
    groupId: number,
    updateProperties: UpdateProperties,
    callback: (group: TabGroup) => void
  ): void

  export interface TabGroupCreatedEvent
    extends chrome.events.Event<(group: TabGroup) => void> {}
  export interface TabGroupMovedEvent
    extends chrome.events.Event<(group: TabGroup) => void> {}
  export interface TabGroupRemovedEvent
    extends chrome.events.Event<(group: TabGroup) => void> {}
  export interface TabGroupUpdated
    extends chrome.events.Event<(group: TabGroup) => void> {}

  export var onCreated: TabGroupCreatedEvent

  export var onMoved: TabGroupMovedEvent

  export var onRemoved: TabGroupRemovedEvent

  export var onUpdated: TabGroupUpdated
}

declare namespace chrome.topSites {
  export interface MostVisitedURL {
    url: string

    title: string
  }

  export function get(callback: (data: MostVisitedURL[]) => void): void

  export function get(): Promise<MostVisitedURL[]>
}

declare namespace chrome.tts {
  export interface TtsEvent {
    charIndex?: number | undefined

    errorMessage?: string | undefined

    length?: number | undefined

    type:
      | 'start'
      | 'end'
      | 'word'
      | 'sentence'
      | 'marker'
      | 'interrupted'
      | 'cancelled'
      | 'error'
      | 'pause'
      | 'resume'
  }

  export interface TtsVoice {
    lang?: string | undefined

    gender?: string | undefined

    voiceName?: string | undefined

    extensionId?: string | undefined

    eventTypes?: string[] | undefined

    remote?: boolean | undefined
  }

  export interface SpeakOptions {
    volume?: number | undefined

    enqueue?: boolean | undefined

    rate?: number | undefined

    onEvent?: ((event: TtsEvent) => void) | undefined

    pitch?: number | undefined

    lang?: string | undefined

    voiceName?: string | undefined

    extensionId?: string | undefined

    gender?: string | undefined

    requiredEventTypes?: string[] | undefined

    desiredEventTypes?: string[] | undefined
  }

  export function isSpeaking(callback?: (speaking: boolean) => void): void

  export function stop(): void

  export function getVoices(): Promise<TtsVoice[]>
  export function getVoices(callback?: (voices: TtsVoice[]) => void): void

  export function speak(utterance: string, callback?: Function): void

  export function speak(
    utterance: string,
    options: SpeakOptions,
    callback?: Function
  ): void

  export function pause(): void

  export function resume(): void
}

declare namespace chrome.ttsEngine {
  export interface SpeakOptions {
    lang?: string | undefined

    voiceName?: string | undefined

    gender?: string | undefined

    volume?: number | undefined

    rate?: number | undefined

    pitch?: number | undefined
  }

  export interface TtsEngineSpeakEvent
    extends chrome.events.Event<
      (
        utterance: string,
        options: SpeakOptions,
        sendTtsEvent: (event: chrome.tts.TtsEvent) => void
      ) => void
    > {}

  export var onSpeak: TtsEngineSpeakEvent

  export var onStop: chrome.events.Event<() => void>

  export var onPause: chrome.events.Event<() => void>

  export var onResume: chrome.events.Event<() => void>
}

declare namespace chrome.types {
  type settingsScope =
    | 'regular'
    | 'regular_only'
    | 'incognito_persistent'
    | 'incognito_session_only'
    | undefined

  export interface ChromeSettingClearDetails {
    scope?: settingsScope
  }

  export interface ChromeSettingSetDetails extends ChromeSettingClearDetails {
    value: any

    scope?: settingsScope
  }

  export interface ChromeSettingGetDetails {
    incognito?: boolean | undefined
  }

  export type DetailsCallback = (details: ChromeSettingGetResultDetails) => void

  export interface ChromeSettingGetResultDetails {
    levelOfControl:
      | 'not_controllable'
      | 'controlled_by_other_extensions'
      | 'controllable_by_this_extension'
      | 'controlled_by_this_extension'

    value: any

    incognitoSpecific?: boolean | undefined
  }

  export interface ChromeSettingChangedEvent
    extends chrome.events.Event<DetailsCallback> {}

  export interface ChromeSetting {
    set(details: ChromeSettingSetDetails, callback?: Function): void

    get(details: ChromeSettingGetDetails, callback?: DetailsCallback): void

    clear(details: ChromeSettingClearDetails, callback?: Function): void

    onChange: ChromeSettingChangedEvent
  }
}

declare namespace chrome.vpnProvider {
  export interface VpnSessionParameters {
    address: string

    broadcastAddress?: string | undefined

    mtu?: string | undefined

    exclusionList: string[]

    inclusionList: string[]

    domainSearch?: string[] | undefined

    dnsServer: string[]
  }

  export interface VpnPlatformMessageEvent
    extends chrome.events.Event<
      (id: string, message: string, error: string) => void
    > {}

  export interface VpnPacketReceptionEvent
    extends chrome.events.Event<(data: ArrayBuffer) => void> {}

  export interface VpnConfigRemovalEvent
    extends chrome.events.Event<(id: string) => void> {}

  export interface VpnConfigCreationEvent
    extends chrome.events.Event<
      (id: string, name: string, data: Object) => void
    > {}

  export interface VpnUiEvent
    extends chrome.events.Event<(event: string, id?: string) => void> {}

  export function createConfig(
    name: string,
    callback: (id: string) => void
  ): void

  export function destroyConfig(id: string, callback?: Function): void

  export function setParameters(
    parameters: VpnSessionParameters,
    callback: Function
  ): void

  export function sendPacket(data: ArrayBuffer, callback?: Function): void

  export function notifyConnectionStateChanged(
    state: string,
    callback?: Function
  ): void

  export var onPlatformMessage: VpnPlatformMessageEvent

  export var onPacketReceived: VpnPacketReceptionEvent

  export var onConfigRemoved: VpnConfigRemovalEvent

  export var onConfigCreated: VpnConfigCreationEvent

  export var onUIEvent: VpnUiEvent
}

declare namespace chrome.wallpaper {
  export interface WallpaperDetails {
    data?: ArrayBuffer | undefined

    url?: string | undefined

    layout: 'STRETCH' | 'CENTER' | 'CENTER_CROPPED'

    filename: string

    thumbnail?: boolean | undefined
  }

  export function setWallpaper(
    details: WallpaperDetails,
    callback: (thumbnail?: ArrayBuffer) => void
  ): void
}

declare namespace chrome.webNavigation {
  export interface GetFrameDetails {
    processId?: number | undefined

    tabId: number

    frameId: number
  }

  export interface GetFrameResultDetails {
    url: string

    documentId: string

    documentLifecycle: DocumentLifecycle

    errorOccurred: boolean

    frameType: FrameType

    parentDocumentId?: string | undefined

    parentFrameId: number
  }

  export interface GetAllFrameDetails {
    tabId: number
  }

  export interface GetAllFrameResultDetails extends GetFrameResultDetails {
    processId: number

    frameId: number
  }

  export interface WebNavigationCallbackDetails {
    tabId: number

    timeStamp: number
  }

  export interface WebNavigationUrlCallbackDetails
    extends WebNavigationCallbackDetails {
    url: string
  }

  export interface WebNavigationReplacementCallbackDetails
    extends WebNavigationCallbackDetails {
    replacedTabId: number
  }

  export interface WebNavigationFramedCallbackDetails
    extends WebNavigationUrlCallbackDetails {
    frameId: number

    frameType: FrameType

    documentId?: string | undefined

    documentLifecycle: DocumentLifecycle

    parentDocumentId?: string | undefined

    processId: number
  }

  export interface WebNavigationFramedErrorCallbackDetails
    extends WebNavigationFramedCallbackDetails {
    error: string
  }

  export interface WebNavigationSourceCallbackDetails
    extends WebNavigationUrlCallbackDetails {
    sourceTabId: number

    sourceProcessId: number

    sourceFrameId: number
  }

  export interface WebNavigationParentedCallbackDetails
    extends WebNavigationFramedCallbackDetails {
    parentFrameId: number
  }

  export interface WebNavigationTransitionCallbackDetails
    extends WebNavigationFramedCallbackDetails {
    transitionType: string

    transitionQualifiers: string[]
  }

  export interface WebNavigationEventFilter {
    url: chrome.events.UrlFilter[]
  }

  export interface WebNavigationEvent<T extends WebNavigationCallbackDetails>
    extends chrome.events.Event<(details: T) => void> {
    addListener(
      callback: (details: T) => void,
      filters?: WebNavigationEventFilter
    ): void
  }

  export interface WebNavigationFramedEvent
    extends WebNavigationEvent<WebNavigationFramedCallbackDetails> {}

  export interface WebNavigationFramedErrorEvent
    extends WebNavigationEvent<WebNavigationFramedErrorCallbackDetails> {}

  export interface WebNavigationSourceEvent
    extends WebNavigationEvent<WebNavigationSourceCallbackDetails> {}

  export interface WebNavigationParentedEvent
    extends WebNavigationEvent<WebNavigationParentedCallbackDetails> {}

  export interface WebNavigationTransitionalEvent
    extends WebNavigationEvent<WebNavigationTransitionCallbackDetails> {}

  export interface WebNavigationReplacementEvent
    extends WebNavigationEvent<WebNavigationReplacementCallbackDetails> {}

  export function getFrame(
    details: GetFrameDetails,
    callback: (details: GetFrameResultDetails | null) => void
  ): void

  export function getFrame(
    details: GetFrameDetails
  ): Promise<GetFrameResultDetails | null>

  export function getAllFrames(
    details: GetAllFrameDetails,
    callback: (details: GetAllFrameResultDetails[] | null) => void
  ): void

  export function getAllFrames(
    details: GetAllFrameDetails
  ): Promise<GetAllFrameResultDetails[] | null>

  export var onReferenceFragmentUpdated: WebNavigationTransitionalEvent

  export var onCompleted: WebNavigationFramedEvent

  export var onHistoryStateUpdated: WebNavigationTransitionalEvent

  export var onCreatedNavigationTarget: WebNavigationSourceEvent

  export var onTabReplaced: WebNavigationReplacementEvent

  export var onBeforeNavigate: WebNavigationParentedEvent

  export var onCommitted: WebNavigationTransitionalEvent

  export var onDOMContentLoaded: WebNavigationFramedEvent

  export var onErrorOccurred: WebNavigationFramedErrorEvent
}

declare namespace chrome.webRequest {
  export type ResourceType =
    | 'main_frame'
    | 'sub_frame'
    | 'stylesheet'
    | 'script'
    | 'image'
    | 'font'
    | 'object'
    | 'xmlhttprequest'
    | 'ping'
    | 'csp_report'
    | 'media'
    | 'websocket'
    | 'other'

  export interface AuthCredentials {
    username: string
    password: string
  }

  export interface HttpHeader {
    name: string
    value?: string | undefined
    binaryValue?: ArrayBuffer | undefined
  }

  export interface BlockingResponse {
    cancel?: boolean | undefined

    redirectUrl?: string | undefined

    responseHeaders?: HttpHeader[] | undefined

    authCredentials?: AuthCredentials | undefined

    requestHeaders?: HttpHeader[] | undefined
  }

  export interface RequestFilter {
    tabId?: number | undefined

    types?: ResourceType[] | undefined

    urls: string[]

    windowId?: number | undefined
  }

  export interface UploadData {
    bytes?: ArrayBuffer | undefined

    file?: string | undefined
  }

  export interface WebRequestBody {
    error?: string | undefined

    formData?: {[key: string]: string[]} | undefined

    raw?: UploadData[] | undefined
  }

  export interface WebAuthChallenger {
    host: string
    port: number
  }

  export interface ResourceRequest {
    url: string

    requestId: string

    frameId: number

    parentFrameId: number

    tabId: number

    type: ResourceType

    timeStamp: number

    initiator?: string | undefined
  }

  export interface WebRequestDetails extends ResourceRequest {
    method: string
  }

  export interface WebRequestHeadersDetails extends WebRequestDetails {
    requestHeaders?: HttpHeader[] | undefined
    documentId: string
    documentLifecycle: DocumentLifecycle
    frameType: FrameType
    frameId: number
    initiator?: string | undefined
    parentDocumentId?: string | undefined
    parentFrameId: number
    requestId: string
    tabId: number
    timeStamp: number
    type: ResourceType
    url: string
  }

  export interface WebRequestBodyDetails extends WebRequestDetails {
    requestBody: WebRequestBody | null
  }

  export interface WebRequestFullDetails
    extends WebRequestHeadersDetails,
      WebRequestBodyDetails {}

  export interface WebResponseDetails extends ResourceRequest {
    statusLine: string

    statusCode: number
  }

  export interface WebResponseHeadersDetails extends WebResponseDetails {
    responseHeaders?: HttpHeader[] | undefined
    method: string
  }

  export interface WebResponseCacheDetails extends WebResponseHeadersDetails {
    ip?: string | undefined

    fromCache: boolean
  }

  export interface WebRedirectionResponseDetails
    extends WebResponseCacheDetails {
    redirectUrl: string
  }

  export interface WebAuthenticationChallengeDetails
    extends WebResponseHeadersDetails {
    scheme: string

    realm?: string | undefined

    challenger: WebAuthChallenger

    isProxy: boolean
  }

  export interface WebResponseErrorDetails extends WebResponseCacheDetails {
    error: string
  }

  export interface WebRequestBodyEvent
    extends chrome.events.EventWithRequiredFilterInAddListener<
      (details: WebRequestBodyDetails) => BlockingResponse | void
    > {
    addListener(
      callback: (details: WebRequestBodyDetails) => BlockingResponse | void,
      filter: RequestFilter,
      opt_extraInfoSpec?: string[]
    ): void
  }

  export interface WebRequestHeadersSynchronousEvent
    extends chrome.events.EventWithRequiredFilterInAddListener<
      (details: WebRequestHeadersDetails) => BlockingResponse | void
    > {
    addListener(
      callback: (details: WebRequestHeadersDetails) => BlockingResponse | void,
      filter: RequestFilter,
      opt_extraInfoSpec?: string[]
    ): void
  }

  export interface WebRequestHeadersEvent
    extends chrome.events.EventWithRequiredFilterInAddListener<
      (details: WebRequestHeadersDetails) => void
    > {
    addListener(
      callback: (details: WebRequestHeadersDetails) => void,
      filter: RequestFilter,
      opt_extraInfoSpec?: string[]
    ): void
  }

  export interface _WebResponseHeadersEvent<T extends WebResponseHeadersDetails>
    extends chrome.events.EventWithRequiredFilterInAddListener<
      (details: T) => void
    > {
    addListener(
      callback: (details: T) => void,
      filter: RequestFilter,
      opt_extraInfoSpec?: string[]
    ): void
  }

  export interface WebResponseHeadersEvent
    extends chrome.events.EventWithRequiredFilterInAddListener<
      (details: WebResponseHeadersDetails) => BlockingResponse | void
    > {
    addListener(
      callback: (details: WebResponseHeadersDetails) => BlockingResponse | void,
      filter: RequestFilter,
      opt_extraInfoSpec?: string[]
    ): void
  }

  export interface WebResponseCacheEvent
    extends _WebResponseHeadersEvent<WebResponseCacheDetails> {}

  export interface WebRedirectionResponseEvent
    extends _WebResponseHeadersEvent<WebRedirectionResponseDetails> {}

  export interface WebAuthenticationChallengeEvent
    extends chrome.events.EventWithRequiredFilterInAddListener<
      (
        details: WebAuthenticationChallengeDetails,
        callback?: (response: BlockingResponse) => void
      ) => void
    > {
    addListener(
      callback: (
        details: WebAuthenticationChallengeDetails,
        callback?: (response: BlockingResponse) => void
      ) => void,
      filter: RequestFilter,
      opt_extraInfoSpec?: string[]
    ): void
  }

  export interface WebResponseErrorEvent
    extends _WebResponseHeadersEvent<WebResponseErrorDetails> {}

  export var MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES: number

  export function handlerBehaviorChanged(callback?: Function): void

  export var onBeforeRequest: WebRequestBodyEvent

  export var onBeforeSendHeaders: WebRequestHeadersSynchronousEvent

  export var onSendHeaders: WebRequestHeadersEvent

  export var onHeadersReceived: WebResponseHeadersEvent

  export var onAuthRequired: WebAuthenticationChallengeEvent

  export var onResponseStarted: WebResponseCacheEvent

  export var onBeforeRedirect: WebRedirectionResponseEvent

  export var onCompleted: WebResponseCacheEvent

  export var onErrorOccurred: WebResponseErrorEvent
}

declare namespace chrome.webstore {
  export function install(
    url: string,
    successCallback?: Function,
    failureCallback?: (error: string, errorCode?: string) => void
  ): void

  export function install(
    successCallback: Function,
    failureCallback?: (error: string, errorCode?: string) => void
  ): void

  export function install(
    failureCallback?: (error: string, errorCode?: string) => void
  ): void

  export interface InstallationStageEvent
    extends chrome.events.Event<(stage: string) => void> {}

  export interface DownloadProgressEvent
    extends chrome.events.Event<(percentDownloaded: number) => void> {}

  export var onInstallStageChanged: InstallationStageEvent

  export var onDownloadProgress: DownloadProgressEvent
}

declare namespace chrome.windows {
  export interface Window {
    tabs?: chrome.tabs.Tab[] | undefined

    top?: number | undefined

    height?: number | undefined

    width?: number | undefined

    state?: windowStateEnum | undefined

    focused: boolean

    alwaysOnTop: boolean

    incognito: boolean

    type?: windowTypeEnum | undefined

    id?: number | undefined

    left?: number | undefined

    sessionId?: string | undefined
  }

  export interface QueryOptions {
    populate?: boolean | undefined

    windowTypes?: windowTypeEnum[] | undefined
  }

  export interface CreateData {
    tabId?: number | undefined

    url?: string | string[] | undefined

    top?: number | undefined

    height?: number | undefined

    width?: number | undefined

    focused?: boolean | undefined

    incognito?: boolean | undefined

    type?: createTypeEnum | undefined

    left?: number | undefined

    state?: windowStateEnum | undefined

    setSelfAsOpener?: boolean | undefined
  }

  export interface UpdateInfo {
    top?: number | undefined

    drawAttention?: boolean | undefined

    height?: number | undefined

    width?: number | undefined

    state?: windowStateEnum | undefined

    focused?: boolean | undefined

    left?: number | undefined
  }

  export interface WindowEventFilter {
    windowTypes: windowTypeEnum[]
  }

  export interface WindowIdEvent
    extends chrome.events.Event<(windowId: number) => void> {
    addListener(
      callback: (windowId: number) => void,
      filters?: WindowEventFilter
    ): void
  }

  export interface WindowReferenceEvent
    extends chrome.events.Event<(window: Window) => void> {
    addListener(
      callback: (window: Window) => void,
      filters?: WindowEventFilter
    ): void
  }

  export type createTypeEnum = 'normal' | 'popup' | 'panel'

  export type windowStateEnum =
    | 'normal'
    | 'minimized'
    | 'maximized'
    | 'fullscreen'
    | 'locked-fullscreen'

  export type windowTypeEnum = 'normal' | 'popup' | 'panel' | 'app' | 'devtools'

  export var WINDOW_ID_CURRENT: -2

  export var WINDOW_ID_NONE: -1

  export function get(
    windowId: number,
    callback: (window: chrome.windows.Window) => void
  ): void

  export function get(windowId: number): Promise<chrome.windows.Window>

  export function get(
    windowId: number,
    queryOptions: QueryOptions,
    callback: (window: chrome.windows.Window) => void
  ): void

  export function get(
    windowId: number,
    queryOptions: QueryOptions
  ): Promise<chrome.windows.Window>

  export function getCurrent(
    callback: (window: chrome.windows.Window) => void
  ): void

  export function getCurrent(): Promise<chrome.windows.Window>

  export function getCurrent(
    queryOptions: QueryOptions,
    callback: (window: chrome.windows.Window) => void
  ): void

  export function getCurrent(
    queryOptions: QueryOptions
  ): Promise<chrome.windows.Window>

  export function create(): Promise<chrome.windows.Window>

  export function create(
    callback: (window?: chrome.windows.Window) => void
  ): void

  export function create(createData: CreateData): Promise<chrome.windows.Window>

  export function create(
    createData: CreateData,
    callback: (window?: chrome.windows.Window) => void
  ): void

  export function getAll(
    callback: (windows: chrome.windows.Window[]) => void
  ): void

  export function getAll(): Promise<chrome.windows.Window[]>

  export function getAll(
    queryOptions: QueryOptions,
    callback: (windows: chrome.windows.Window[]) => void
  ): void

  export function getAll(
    queryOptions: QueryOptions
  ): Promise<chrome.windows.Window[]>

  export function update(
    windowId: number,
    updateInfo: UpdateInfo
  ): Promise<chrome.windows.Window>

  export function update(
    windowId: number,
    updateInfo: UpdateInfo,
    callback: (window: chrome.windows.Window) => void
  ): void

  export function remove(windowId: number): Promise<void>

  export function remove(windowId: number, callback: Function): void

  export function getLastFocused(
    callback: (window: chrome.windows.Window) => void
  ): void

  export function getLastFocused(): Promise<chrome.windows.Window>

  export function getLastFocused(
    queryOptions: QueryOptions,
    callback: (window: chrome.windows.Window) => void
  ): void

  export function getLastFocused(
    queryOptions: QueryOptions
  ): Promise<chrome.windows.Window>

  export var onRemoved: WindowIdEvent

  export var onCreated: WindowReferenceEvent

  export var onFocusChanged: WindowIdEvent

  export var onBoundsChanged: WindowReferenceEvent
}

declare namespace chrome.declarativeNetRequest {
  export const DYNAMIC_RULESET_ID: string

  export const GETMATCHEDRULES_QUOTA_INTERVAL: number

  export const GUARANTEED_MINIMUM_STATIC_RULES: number

  export const MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: number

  export const MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: number

  export const MAX_NUMBER_OF_REGEX_RULES: number

  export const MAX_NUMBER_OF_STATIC_RULESETS: number

  export const SESSION_RULESET_ID: string

  export enum RequestMethod {
    CONNECT = 'connect',
    DELETE = 'delete',
    GET = 'get',
    HEAD = 'head',
    OPTIONS = 'options',
    PATCH = 'patch',
    POST = 'post',
    PUT = 'put'
  }

  export enum ResourceType {
    MAIN_FRAME = 'main_frame',
    SUB_FRAME = 'sub_frame',
    STYLESHEET = 'stylesheet',
    SCRIPT = 'script',
    IMAGE = 'image',
    FONT = 'font',
    OBJECT = 'object',
    XMLHTTPREQUEST = 'xmlhttprequest',
    PING = 'ping',
    CSP_REPORT = 'csp_report',
    MEDIA = 'media',
    WEBSOCKET = 'websocket',
    OTHER = 'other'
  }

  export enum RuleActionType {
    BLOCK = 'block',
    REDIRECT = 'redirect',
    ALLOW = 'allow',
    UPGRADE_SCHEME = 'upgradeScheme',
    MODIFY_HEADERS = 'modifyHeaders',
    ALLOW_ALL_REQUESTS = 'allowAllRequests'
  }

  export enum UnsupportedRegexReason {
    SYNTAX_ERROR = 'syntaxError',
    MEMORY_LIMIT_EXCEEDED = 'memoryLimitExceeded'
  }

  export enum DomainType {
    FIRST_PARTY = 'firstParty',
    THIRD_PARTY = 'thirdParty'
  }

  export enum HeaderOperation {
    APPEND = 'append',
    SET = 'set',
    REMOVE = 'remove'
  }

  export interface RequestDetails {
    frameId: number

    initiator?: string | undefined

    method: string

    partentFrameId: number

    requestId: string

    tabId: number

    type: ResourceType

    url: string
  }

  export interface Rule {
    action: RuleAction

    condition: RuleCondition

    id: number

    priority?: number | undefined
  }

  export interface RuleAction {
    redirect?: Redirect | undefined

    requestHeaders?: ModifyHeaderInfo[] | undefined

    responseHeaders?: ModifyHeaderInfo[] | undefined

    type: RuleActionType
  }

  export interface RuleCondition {
    domainType?: DomainType | undefined

    domains?: string[] | undefined

    excludedDomains?: string[] | undefined

    initiatorDomains?: string[] | undefined

    excludedInitiatorDomains?: string[] | undefined

    requestDomains?: string[] | undefined

    excludedRequestDomains?: string[] | undefined

    excludedRequestMethods?: RequestMethod[] | undefined

    excludedResourceTypes?: ResourceType[] | undefined

    excludedTabIds?: number[] | undefined

    isUrlFilterCaseSensitive?: boolean | undefined

    regexFilter?: string | undefined

    requestMethods?: RequestMethod[]

    tabIds?: number[] | undefined

    urlFilter?: string | undefined

    resourceTypes?: ResourceType[] | undefined
  }

  export interface MatchedRule {
    ruleId: number

    rulesetId: string
  }

  export interface MatchedRuleInfo {
    rule: MatchedRule

    tabId: number

    timeStamp: number
  }

  export interface MatchedRulesFilter {
    minTimeStamp?: number | undefined

    tabId?: number | undefined
  }

  export interface ModifyHeaderInfo {
    header: string

    operation: HeaderOperation

    value?: string | undefined
  }

  export interface QueryKeyValue {
    key: string
    value: string
  }

  export interface QueryTransform {
    addOrReplaceParams?: QueryKeyValue[] | undefined

    removeParams?: string[] | undefined
  }

  export interface URLTransform {
    fragment?: string | undefined

    host?: string | undefined

    password?: string | undefined

    path?: string | undefined

    port?: string | undefined

    query?: string | undefined

    queryTransform?: QueryTransform | undefined

    scheme?: string | undefined

    username?: string | undefined
  }

  export interface RegexOptions {
    isCaseSensitive?: boolean | undefined

    regex: string

    requireCapturing?: boolean | undefined
  }

  export interface IsRegexSupportedResult {
    isSupported: boolean

    reason?: UnsupportedRegexReason | undefined
  }

  export interface TabActionCountUpdate {
    increment: number

    tabId: number
  }

  export interface ExtensionActionOptions {
    displayActionCountAsBadgeText?: boolean | undefined

    tabUpdate?: TabActionCountUpdate | undefined
  }

  export interface Redirect {
    extensionPath?: string | undefined

    regexSubstitution?: string | undefined

    transform?: URLTransform | undefined

    url?: string | undefined
  }

  export interface UpdateRuleOptions {
    addRules?: Rule[] | undefined

    removeRuleIds?: number[] | undefined
  }

  export interface UpdateStaticRulesOptions {
    disableRuleIds?: number[]

    enableRuleIds?: number[]

    rulesetId: string
  }

  export interface UpdateRulesetOptions {
    disableRulesetIds?: string[] | undefined

    enableRulesetIds?: string[] | undefined
  }

  export interface MatchedRuleInfoDebug {
    request: RequestDetails

    rule: MatchedRule
  }

  export interface Ruleset {
    enabled: boolean

    id: string

    path: string
  }

  export interface RulesMatchedDetails {
    rulesMatchedInfo: MatchedRuleInfo[]
  }

  export function getAvailableStaticRuleCount(
    callback: (count: number) => void
  ): void

  export function getAvailableStaticRuleCount(): Promise<number>

  export function getDynamicRules(callback: (rules: Rule[]) => void): void

  export function getDynamicRules(): Promise<Rule[]>

  export function getEnabledRulesets(
    callback: (rulesetIds: string[]) => void
  ): void

  export function getEnabledRulesets(): Promise<string[]>

  export function getMatchedRules(
    filter: MatchedRulesFilter | undefined,
    callback: (details: RulesMatchedDetails) => void
  ): void

  export function getMatchedRules(
    filter: MatchedRulesFilter | undefined
  ): Promise<RulesMatchedDetails>

  export function getMatchedRules(
    callback: (details: RulesMatchedDetails) => void
  ): void

  export function getMatchedRules(): Promise<RulesMatchedDetails>

  export function getSessionRules(callback: (rules: Rule[]) => void): void

  export function getSessionRules(): Promise<Rule[]>

  export function isRegexSupported(
    regexOptions: RegexOptions,
    callback: (result: IsRegexSupportedResult) => void
  ): void

  export function isRegexSupported(
    regexOptions: RegexOptions
  ): Promise<IsRegexSupportedResult>

  export function setExtensionActionOptions(
    options: ExtensionActionOptions,
    callback: Function
  ): void

  export function setExtensionActionOptions(
    options: ExtensionActionOptions
  ): Promise<void>

  export function updateDynamicRules(
    options: UpdateRuleOptions,
    callback: Function
  ): void

  export function updateDynamicRules(options: UpdateRuleOptions): Promise<void>

  export function updateEnabledRulesets(
    options: UpdateRulesetOptions,
    callback: Function
  ): void

  export function updateEnabledRulesets(
    options: UpdateRulesetOptions
  ): Promise<void>

  export function updateSessionRules(
    options: UpdateRuleOptions,
    callback: Function
  ): void

  export function updateSessionRules(options: UpdateRuleOptions): Promise<void>

  export function updateStaticRules(
    options: UpdateStaticRulesOptions
  ): Promise<void>
  export function updateStaticRules(
    options: UpdateStaticRulesOptions,
    callback?: () => void
  ): void

  export interface RuleMatchedDebugEvent
    extends chrome.events.Event<(info: MatchedRuleInfoDebug) => void> {}

  export var onRuleMatchedDebug: RuleMatchedDebugEvent
}

declare namespace chrome.sidePanel {
  export interface GetPanelOptions {
    tabId?: number
  }

  export type OpenOptions = {
    tabId?: number

    windowId?: number
  } & (
    | {
        tabId: number
      }
    | {
        windowId: number
      }
  )

  export interface PanelBehavior {
    openPanelOnActionClick?: boolean
  }

  export interface PanelOptions {
    enabled?: boolean

    path?: string

    tabId?: number
  }

  export interface SidePanel {
    default_path: string
  }

  export function getOptions(
    options: GetPanelOptions,
    callback: (options: PanelOptions) => void
  ): void

  export function getOptions(options: GetPanelOptions): Promise<PanelOptions>

  export function getPanelBehavior(
    callback: (behavior: PanelBehavior) => void
  ): void

  export function getPanelBehavior(): Promise<PanelBehavior>

  export function open(options: OpenOptions, callback: () => void): void

  export function open(options: OpenOptions): Promise<void>

  export function setOptions(options: PanelOptions, callback: () => void): void

  export function setOptions(options: PanelOptions): Promise<void>

  export function setPanelBehavior(
    behavior: PanelBehavior,
    callback: () => void
  ): void

  export function setPanelBehavior(behavior: PanelBehavior): Promise<void>
}
