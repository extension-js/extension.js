/**
 * Logo Component from Preact Website Logo
 * https://github.dev/preactjs/preact-www/blob/master/src/index.jsx
 */
import {Component} from 'preact'

export default class Logo extends Component {
  state = {i: 0, hover: false}

  hover = () => {
    this.setState({hover: true})
  }

  hoverOut = () => {
    this.setState({hover: false})
  }

  frame = () => {
    this.timer = null
    if (!this.mounted) return
    this.setState({i: this.state.i + 1}, this.next)
  }

  next = () => {
    let {hover} = this.state
    if (!this.mounted || !hover || this.timer) return
    this.timer = (requestAnimationFrame || setTimeout)(this.frame, 15)
  }

  componentDidMount() {
    this.mounted = true
    this.startTimer = setTimeout(this.next, 5000)
  }

  componentWillUnmount() {
    clearTimeout(this.startTimer)
    ;(cancelAnimationFrame || clearTimeout)(this.timer)
    this.mounted = this.timer = false
  }

  componentDidUpdate() {
    this.next()
  }

  renderEllipse(fg, deg, offset) {
    let gapLength = Math.sin((offset / 500) * Math.PI) * 30 + 60
    let lineLength = 894 / 2 - gapLength
    return (
      <ellipse
        cx="0"
        cy="0"
        rx="75px"
        ry="196px"
        stroke-width="16px"
        stroke-dasharray={`${lineLength} ${gapLength}`}
        stroke-dashoffset={
          offset * 10 + Math.sin((offset / 100) * Math.PI) * 200
        }
        fill="none"
        stroke={fg}
        transform={`rotate(${deg})`}
      />
    )
  }

  render(
    {
      inverted = false,
      fg = '#673ab8',
      bg = 'white',
      component,
      title,
      ...props
    },
    {i}
  ) {
    if (inverted) [bg, fg] = [fg, bg]

    return (
      <svg
        aria-label={title}
        height="34px"
        viewBox={`-256 -256 512 512`}
        style="display:inline-block; margin:-.25em 0 0; vertical-align:middle;"
        onMouseOver={this.hover}
        onMouseOut={this.hoverOut}
        onContextMenu={this.contextMenu}
        {...props}
      >
        <path
          d="M0,-256 221.7025033688164,-128 221.7025033688164,128 0,256 -221.7025033688164,128 -221.7025033688164,-128z"
          fill={bg}
        />
        {this.renderEllipse(fg, 52, i)}
        {this.renderEllipse(fg, -52, -0.7 * i)}
        <circle cx="0" cy="0" r="34" fill={fg} />
      </svg>
    )
  }
}
