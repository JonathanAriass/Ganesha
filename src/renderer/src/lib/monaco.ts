import * as monaco from 'monaco-editor'
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

/** Monaco theme name for each app theme. */
export const MONACO_THEME = { midnight: 'midnight', light: 'daylight' } as const

// Default until settings load; applyTheme() re-applies the saved choice.
monaco.editor.setTheme('midnight')

export { monaco }
