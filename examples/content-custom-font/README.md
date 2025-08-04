# Content Custom Font Example

A browser extension example demonstrating how to properly load and use custom fonts in browser extensions with Tailwind CSS v4.

## 🎯 Problem Solved

This example addresses the common issue where custom fonts fail to load in browser extensions, as reported in [GitHub Issue #271](https://github.com/extension-js/extension.js/issues/271).

## 🚀 Features

- **Custom Font Loading**: Demonstrates proper font loading in browser extensions
- **Custom Font Loading**: Demonstrates proper font loading in browser extensions
- **Multiple Font Formats**: Supports WOFF2, WOFF, TTF, and OTF formats
- **Web Accessible Resources**: Properly configured manifest.json for font access
- **Font Display Optimization**: Uses `font-display: swap` for better loading experience

## 📁 Project Structure

```
content-custom-font/
├── content/
│   ├── scripts.js          # Content script with font demo
│   └── styles.css          # CSS with font-face declarations
├── public/
│   ├── fonts/              # Font files directory
│   │   └── README.md       # Font setup instructions
│   └── logo.svg            # Extension logo
├── images/
│   └── extension_48.png    # Extension icon
├── manifest.json           # Extension manifest with web accessible resources
├── package.json            # Dependencies and metadata
├── postcss.config.js       # PostCSS configuration for Tailwind v4
└── background.js           # Background script
```

## 🛠️ Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Add Font Files

Place your font files in the `public/fonts/` directory:

```
public/fonts/
├── DMMono-Regular.woff2
├── DMMono-Italic.woff2
├── DMSans-Regular.woff2
├── DMSans-Italic.woff2
├── Inter-Regular.woff2
└── CustomFont-Regular.woff2
```

### 3. Configure Font Declarations

The CSS file (`content/styles.css`) already includes example `@font-face` declarations:

```css
@font-face {
  font-family: 'DM Mono';
  font-weight: 100 800;
  font-display: swap;
  font-style: normal;
  src:
    url('/fonts/DMMono-Regular.woff2') format('woff2'),
    url('/fonts/DMMono-Regular.woff') format('woff');
}
```

### 4. Use Custom Fonts in CSS

The CSS file includes custom font classes:

```css
.font_roboto {
  font-family: 'Roboto', sans-serif;
  background-color: #f3f4f6;
}

.font_source_code_pro {
  font-family: 'Source Code Pro', monospace;
  background-color: #fef3c7;
}
```

### 5. Verify Manifest Configuration

The `manifest.json` includes proper web accessible resources:

```json
{
  "web_accessible_resources": [
    {
      "resources": [
        "fonts/*.woff2",
        "fonts/*.woff",
        "fonts/*.ttf",
        "fonts/*.otf"
      ],
      "matches": ["<all_urls>"]
    }
  ]
}
```

## 🎨 Usage

### Using Custom Fonts with CSS Classes

```html
<div class="font_roboto">Roboto font</div>
<div class="font_source_code_pro">Source Code Pro font</div>
```

### Using Custom Fonts with CSS Classes

```html
<div class="font_dm_mono">DM Mono font</div>
<div class="font_dm_sans">DM Sans font</div>
<div class="font_inter">Inter font</div>
<div class="font_custom">Custom font</div>
```

## 🔧 Development

### Build the Extension

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

### Load in Browser

1. Open Chrome/Edge and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension directory
4. Navigate to any webpage to see the font demo

## 🐛 Troubleshooting

### Fonts Not Loading

1. **Check File Paths**: Ensure font files are in `public/fonts/` directory
2. **Verify Manifest**: Check `web_accessible_resources` includes font patterns
3. **Console Errors**: Check browser console for font loading errors
4. **File Permissions**: Ensure font files are readable

### Common Issues

- **CORS Errors**: Fonts must be declared in `web_accessible_resources`
- **Path Issues**: Use relative paths starting with `/fonts/`
- **Format Support**: Use WOFF2 for best compatibility and performance

## 📚 Best Practices

### Font Loading

- Use `.woff2` format for best compression and performance
- Include fallback fonts in your CSS declarations
- Use `font-display: swap` for better user experience
- Test font loading across different browsers

### Browser Extension Specific

- Always declare fonts in `web_accessible_resources`
- Use relative paths from the extension root
- Test in both Chrome and Firefox
- Consider font file size for extension performance

### CSS Integration

- Define custom font classes in your CSS
- Use consistent naming conventions
- Include fallback fonts in font family definitions
- Test custom classes with your fonts

## 🔗 Related Resources

- [GitHub Issue #271](https://github.com/extension-js/extension.js/issues/271) - Original font loading issue
- [MDN Web Fonts](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face) - Font-face documentation
- [MDN CSS Font Family](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family) - CSS font family documentation
- [Chrome Extension Manifest](https://developer.chrome.com/docs/extensions/mv3/manifest/) - Manifest documentation

## 📄 License

MIT License - see the main project license for details.
