import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { monaco } from '../lib/monaco'
import { setCompletionCtx, clearCompletionCtx, type CompletionCtx } from '../lib/monaco-completions'

interface Props {
  initialValue: string
  language: string
  onChange: (text: string) => void
  /** ⌘/Ctrl-↵. The parent decides what to run by querying the handle. */
  onRun: () => void
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

/** Mount-once Monaco instance; parents remount it (via key) to replace content. */
const MonacoEditor = forwardRef<MonacoEditorHandle, Props>(function MonacoEditor(
  { initialValue, language, onChange, onRun, completions },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
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
      tabSize: 2
    })
    editorRef.current = editor
    const model = editor.getModel()
    // Thunk, not value: completion props (objects load async) change across renders.
    if (model) setCompletionCtx(model.id, () => completionsRef.current ?? null)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current())
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
