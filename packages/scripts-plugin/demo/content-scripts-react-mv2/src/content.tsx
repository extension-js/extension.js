// content script don't have an HTML file
// therefore we cannot load CSS in the initial chunk
// @ts-ignore
import('./content.css')
import {render} from 'react-dom'
import {App} from './App'

console.log('ok~2211~!')

setTimeout(initial, 1000)
function initial() {
  const root = document.createElement('div')
  root.id = 'extension-root'
  document.body.appendChild(root)
  render(<App />, root)
}
