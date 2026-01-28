import {h} from 'preact'
import iconUrl from "../images/icon.png"

const logo = iconUrl

export default function ContentApp() {
  const handleClick = () => {
    if (import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox') {
      browser.runtime.sendMessage({type: 'openSidebar'})
    } else {
      chrome.runtime.sendMessage({type: 'openSidebar'})
    }
  }

  return (
    <button
      type="button"
      className="content_pill"
      onClick={handleClick}
      aria-label="Open sidebar"
    >
      <img className="content_pill_logo" src={logo} alt="" aria-hidden="true" />
      <span className="content_pill_text">Open sidebar</span>
    </button>
  )
}
