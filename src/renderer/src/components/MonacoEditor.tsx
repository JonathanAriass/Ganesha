import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { monaco } from '../lib/monaco'
import { setCompletionCtx, clearCompletionCtx, type CompletionCtx } from '../lib/monaco-completions'

interface Props {
  initialValue: string
  language: string
  onChange: (text: string) => void
  /** ⌘/Ctrl-↵. The parent decides what to run by querying the handle. */
  onRun: () => void
  /** ⌘/Ctrl-⇧-↵: run every statement in the tab. */
  onRunAll?: () => void
  completions?: CompletionCtx
}

/** What run() needs to know about editor state, pulled (not pushed) so there is
 *  exactly one run path for the keybinding, the Run button, and runOnOpen. */
export interface MonacoEditorHandle {
  /** The selected text, or null when the selection is empty/whitespace-only. */
  selectionText(): string | null
  /** Cursor position as an offset into the document (0 if no cursor yet). */
  cursorOffset(): number
}

/** A single body-level container for Monaco's overflowing widgets (suggest, hover).
 *  Inside the editor's DOM these stacked below the app's results/sidebar panels and
 *  got occluded; appended to <body> with a high z-index they always sit on top.
 *  The `.monaco-editor` class is required so Monaco's widget CSS (scoped to it) applies. */
function overflowWidgetsContainer(): HTMLElement {
  let el = document.getElementById('monaco-overflow-widgets')
  if (!el) {
    el = document.createElement('div')
    el.id = 'monaco-overflow-widgets'
    el.className = 'monaco-editor'
    el.style.cssText = 'position:absolute;top:0;left:0;z-index:10000'
    document.body.appendChild(el)
  }
  return el
}

/** Mount-once Monaco instance; parents remount it (via key) to replace content. */
const MonacoEditor = forwardRef<MonacoEditorHandle, Props>(function MonacoEditor(
  { initialValue, language, onChange, onRun, onRunAll, completions },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const onRunAllRef = useRef(onRunAll)
  onRunAllRef.current = onRunAll
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const completionsRef = useRef(completions)
  completionsRef.current = completions

  useImperativeHandle(ref, () => ({
    selectionText() {
      const editor = editorRef.current
      const sel = editor?.getSelection()
      if (!editor || !sel || sel.isEmpty()) return null
      const text = editor.getModel()?.getValueInRange(sel) ?? ''
      // Whitespace-only selections count as "no selection".
      return text.trim() ? text : null
    },
    cursorOffset() {
      const editor = editorRef.current
      const model = editor?.getModel()
      const position = editor?.getPosition()
      return model && position ? model.getOffsetAt(position) : 0
    }
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const editor = monaco.editor.create(host, {
      value: initialValue,
      language,
      // No theme here: monaco themes are global, and passing one at create()
      // would reset the app-wide choice every time a tab mounts.
      minimap: { enabled: false },
      fontSize: 13,
      // Installs a per-editor resize watcher — deliberate while editor instances are few; revisit if tab counts grow.
      automaticLayout: true,
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      tabSize: 2,
      // Render suggest/hover widgets in a body-level container (see above) instead
      // of inside the editor: in our flex layout the editor's own layers AND the
      // results/sidebar panels stacked OVER the widget, occluding the labels.
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowWidgetsContainer()
    })
    editorRef.current = editor
    const model = editor.getModel()
    // Thunk, not value: completion props (objects load async) change across renders.
    if (model) setCompletionCtx(model.id, () => completionsRef.current ?? null)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
      onRunAllRef.current?.()
    )
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))
    editor.focus()
    return () => {
      sub.dispose()
      if (model) clearCompletionCtx(model.id)
      editorRef.current = null
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design (remount via key)
  }, [])

  return <div className="editor-host" ref={hostRef} />
})

export default MonacoEditor
