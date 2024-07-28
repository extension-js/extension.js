import './styles.css'
import {getContentHtml} from './content'

console.log('hello from content_scripts')

document.body.innerHTML += `<div id="extension-root">${getContentHtml()}</div>`
