import {render} from 'preact'
import ContentApp from './ContentApp'
import './styles.css'

setTimeout(initial, 1000)

function initial() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  render(<ContentApp />, rootDiv)
}
