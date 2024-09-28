import {HashRouter as Router, Switch, Route, Link} from 'react-router-dom'
import './styles.css'
import reactLogo from '../images/react.png'

function Home() {
  return (
    <main>
      <h1>
        <img
          className="react"
          src={reactLogo}
          alt="The React logo"
          width="120px"
        />
        <br />
        Welcome to your React Router Extension.
      </h1>
      <pre>
        <code>{window.location.href}</code>
      </pre>
    </main>
  )
}

function About() {
  return (
    <main>
      <h1>
        <img
          className="react"
          src={reactLogo}
          alt="The React logo"
          width="120px"
        />
        <br />
        Learn more about your React Router DOM Extension.
      </h1>
      <pre>
        <code>{window.location.href}</code>
      </pre>
    </main>
  )
}

function Users() {
  return (
    <main>
      <h1>
        <img
          className="react"
          src={reactLogo}
          alt="The React logo"
          width="120px"
        />
        <br />
        List of users of your React Router DOM Extension.
      </h1>
      <pre>
        <code>{window.location.href}</code>
      </pre>
    </main>
  )
}

export default function NewTabApp() {
  return (
    <Router>
      <div>
        <nav>
          <Link to="/">Home</Link> <Link to="/about">About</Link>{' '}
          <Link to="/users">Users</Link>
        </nav>

        <Switch>
          <Route path="/about">
            <About />
          </Route>
          <Route path="/users">
            <Users />
          </Route>
          <Route path="/">
            <Home />
          </Route>
        </Switch>
      </div>
    </Router>
  )
}
