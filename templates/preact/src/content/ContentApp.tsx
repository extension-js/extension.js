import {h} from 'preact'
import iconUrl from '../images/icon.png'

const logo = iconUrl

export default function ContentApp() {
  const envBrowser = import.meta.env.EXTENSION_PUBLIC_BROWSER
  const isFirefoxLike =
    envBrowser === 'firefox' ||
    envBrowser === 'gecko-based' ||
    /Firefox/i.test(navigator.userAgent)

  const handleClick = () => {
    if (isFirefoxLike) return
    chrome.runtime.sendMessage({type: 'openSidebar'})
  }

  return (
    <button
      type="button"
      className="content_pill"
      onClick={handleClick}
      aria-label="Open sidebar"
      disabled={isFirefoxLike}
    >
      <img className="content_pill_logo" src={logo} alt="" aria-hidden="true" />
      <span className="content_pill_text">
        {isFirefoxLike
          ? 'Click the browser action to open the sidebar'
          : 'Open sidebar'}
      </span>
    </button>
  )
}
