import './styles.css'
import javascriptLogo from '../images/icon.png'
import {watchPageTitle} from './page-title.js'

const NO_PAGE_TEXT = 'Open a web page to see its title here.'

function SidebarApp() {
  const root = document.getElementById('root')
  if (!root) return

  const app = document.createElement('div')
  app.className = 'sidebar_app'

  const logo = document.createElement('img')
  logo.className = 'sidebar_logo'
  logo.src = javascriptLogo
  logo.alt = 'The JavaScript logo'

  const title = document.createElement('h1')
  title.className = 'sidebar_title'
  title.textContent = 'Sidebar Panel'

  const link = document.createElement('a')
  link.href = 'https://extension.js.org'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = 'Extension.js docs'

  const description = document.createElement('p')
  description.className = 'sidebar_description'
  description.append('Learn more in the ', link, ' .')

  const pageTitle = document.createElement('p')
  pageTitle.className = 'sidebar_page_title'
  pageTitle.textContent = NO_PAGE_TEXT

  app.append(logo, title, description, pageTitle)
  root.replaceChildren(app)

  watchPageTitle((answer) => {
    pageTitle.textContent = answer ? answer.title : NO_PAGE_TEXT
  })
}

SidebarApp()
