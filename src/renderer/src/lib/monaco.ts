import * as monaco from 'monaco-editor'
import type { ThemeId } from '@shared/domain'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Bundle workers locally (no CDN). JS/TS worker serves the mongo-shell 'javascript' mode.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    if (label === 'javascript' || label === 'typescript') return new TsWorker()
    return new EditorWorker()
  }
}

// Mongo shell input isn't a real JS program — no bogus "db is undefined" squiggles.
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false
})

monaco.editor.defineTheme('midnight', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '818cf8' },
    { token: 'string', foreground: '34d399' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'comment', foreground: '5b6478' }
  ],
  colors: {
    'editor.background': '#12151d',
    'editor.foreground': '#e3e7f0',
    'editor.lineHighlightBackground': '#1b1f2c80',
    'editorLineNumber.foreground': '#3a4056',
    'editorCursor.foreground': '#6366f1',
    'editor.selectionBackground': '#6366f133',
    // Autocomplete + hover widgets — explicitly themed so labels are legible
    // (inheritance left them low-contrast/invisible against our custom palette).
    'editorWidget.background': '#1b1f2c',
    'editorWidget.border': '#232838',
    'editorWidget.foreground': '#e3e7f0',
    'editorSuggestWidget.background': '#1b1f2c',
    'editorSuggestWidget.border': '#232838',
    'editorSuggestWidget.foreground': '#e3e7f0',
    'editorSuggestWidget.selectedBackground': '#2a3050',
    'editorSuggestWidget.selectedForeground': '#ffffff',
    'editorSuggestWidget.highlightForeground': '#818cf8',
    'editorSuggestWidget.focusHighlightForeground': '#a5b4fc',
    'editorHoverWidget.background': '#1b1f2c',
    'editorHoverWidget.border': '#232838'
  }
})

monaco.editor.defineTheme('daylight', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '4f46e5' },
    { token: 'string', foreground: '047857' },
    { token: 'number', foreground: 'b45309' },
    { token: 'comment', foreground: '9aa3b5' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1b2230',
    'editor.lineHighlightBackground': '#f1f3f780',
    'editorLineNumber.foreground': '#c0c7d4',
    'editorCursor.foreground': '#4f46e5',
    'editor.selectionBackground': '#6366f133',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d9dde6',
    'editorWidget.foreground': '#1b2230',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#d9dde6',
    'editorSuggestWidget.foreground': '#1b2230',
    'editorSuggestWidget.selectedBackground': '#eef0f4',
    'editorSuggestWidget.selectedForeground': '#1b2230',
    'editorSuggestWidget.highlightForeground': '#4f46e5',
    'editorSuggestWidget.focusHighlightForeground': '#4338ca',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#d9dde6'
  }
})

/** Register a Monaco editor theme from a compact color spec. Token foregrounds are hex
 *  without '#'; editor colors take full #rrggbb[aa]. Keeps the extra themes DRY. */
function defineEditorTheme(
  name: string,
  base: 'vs' | 'vs-dark',
  c: {
    bg: string; fg: string; kw: string; str: string; num: string; com: string
    ln: string; lh: string; cur: string; sel: string
    widget: string; border: string; selBg: string; accent: string
  }
): void {
  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: 'keyword', foreground: c.kw.replace('#', '') },
      { token: 'string', foreground: c.str.replace('#', '') },
      { token: 'number', foreground: c.num.replace('#', '') },
      { token: 'comment', foreground: c.com.replace('#', '') }
    ],
    colors: {
      'editor.background': c.bg,
      'editor.foreground': c.fg,
      'editor.lineHighlightBackground': c.lh,
      'editorLineNumber.foreground': c.ln,
      'editorCursor.foreground': c.cur,
      'editor.selectionBackground': c.sel,
      'editorWidget.background': c.widget,
      'editorWidget.border': c.border,
      'editorWidget.foreground': c.fg,
      'editorSuggestWidget.background': c.widget,
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.foreground': c.fg,
      'editorSuggestWidget.selectedBackground': c.selBg,
      'editorSuggestWidget.selectedForeground': c.fg,
      'editorSuggestWidget.highlightForeground': c.accent,
      'editorHoverWidget.background': c.widget,
      'editorHoverWidget.border': c.border
    }
  })
}

defineEditorTheme('dracula', 'vs-dark', { bg: '#282a36', fg: '#f8f8f2', kw: '#ff79c6', str: '#f1fa8c', num: '#bd93f9', com: '#6272a4', ln: '#6272a4', lh: '#44475a66', cur: '#f8f8f2', sel: '#bd93f944', widget: '#21222c', border: '#191a21', selBg: '#343746', accent: '#bd93f9' })
defineEditorTheme('nord', 'vs-dark', { bg: '#2e3440', fg: '#d8dee9', kw: '#81a1c1', str: '#a3be8c', num: '#b48ead', com: '#616e88', ln: '#4c566a', lh: '#3b425266', cur: '#d8dee9', sel: '#88c0d044', widget: '#292e39', border: '#3b4252', selBg: '#3b4252', accent: '#88c0d0' })
defineEditorTheme('tokyo-night', 'vs-dark', { bg: '#1a1b26', fg: '#a9b1d6', kw: '#bb9af7', str: '#9ece6a', num: '#ff9e64', com: '#565f89', ln: '#3b4261', lh: '#24283b80', cur: '#c0caf5', sel: '#7aa2f733', widget: '#16161e', border: '#292e42', selBg: '#24283b', accent: '#7aa2f7' })
defineEditorTheme('catppuccin-mocha', 'vs-dark', { bg: '#1e1e2e', fg: '#cdd6f4', kw: '#cba6f7', str: '#a6e3a1', num: '#fab387', com: '#6c7086', ln: '#45475a', lh: '#31324466', cur: '#f5e0dc', sel: '#cba6f733', widget: '#181825', border: '#313244', selBg: '#313244', accent: '#cba6f7' })
defineEditorTheme('gruvbox', 'vs-dark', { bg: '#282828', fg: '#ebdbb2', kw: '#fb4934', str: '#b8bb26', num: '#d3869b', com: '#928374', ln: '#7c6f64', lh: '#3c383666', cur: '#ebdbb2', sel: '#fe801933', widget: '#1d2021', border: '#3c3836', selBg: '#3c3836', accent: '#fe8019' })
defineEditorTheme('rose-pine', 'vs-dark', { bg: '#191724', fg: '#e0def4', kw: '#31748f', str: '#f6c177', num: '#ebbcba', com: '#6e6a86', ln: '#524f67', lh: '#1f1d2e99', cur: '#e0def4', sel: '#c4a7e733', widget: '#1f1d2e', border: '#26233a', selBg: '#26233a', accent: '#c4a7e7' })
defineEditorTheme('catppuccin-latte', 'vs', { bg: '#eff1f5', fg: '#4c4f69', kw: '#8839ef', str: '#40a02b', num: '#fe640b', com: '#8c8fa1', ln: '#bcc0cc', lh: '#e6e9ef99', cur: '#dc8a78', sel: '#8839ef22', widget: '#ffffff', border: '#ccd0da', selBg: '#e6e9ef', accent: '#8839ef' })
defineEditorTheme('solarized-light', 'vs', { bg: '#fdf6e3', fg: '#657b83', kw: '#859900', str: '#2aa198', num: '#d33682', com: '#93a1a1', ln: '#93a1a1', lh: '#eee8d599', cur: '#657b83', sel: '#268bd222', widget: '#fffef8', border: '#e5ddc5', selBg: '#eee8d5', accent: '#268bd2' })

/** Monaco theme name for each app theme id. */
export const MONACO_THEME: Record<ThemeId, string> = {
  midnight: 'midnight',
  light: 'daylight',
  dracula: 'dracula',
  nord: 'nord',
  'tokyo-night': 'tokyo-night',
  'catppuccin-mocha': 'catppuccin-mocha',
  gruvbox: 'gruvbox',
  'rose-pine': 'rose-pine',
  'catppuccin-latte': 'catppuccin-latte',
  'solarized-light': 'solarized-light'
}

// Default until settings load; applyTheme() re-applies the saved choice.
monaco.editor.setTheme('midnight')

export { monaco }
