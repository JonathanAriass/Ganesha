import { useEffect, useRef } from 'react'
import { monaco } from '../lib/monaco'
import { setCompletionCtx, clearCompletionCtx, type CompletionCtx } from '../lib/monaco-completions'

interface Props {
  initialValue: string
  language: string
  onChange: (text: string) => void
  /** ⌘/Ctrl-↵ — receives the selected text when a non-empty selection exists. */
  onRun: (selection?: string) => void
  completions?: CompletionCtx
}

/** Mount-once Monaco instance; parents remount it (via key) to replace content. */
export default function MonacoEditor({ initialValue, language, onChange, onRun, completions }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const completionsRef = useRef(completions)
  completionsRef.current = completions

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
    const model = editor.getModel()
    // Thunk, not value: completion props (objects load async) change across renders.
    if (model) setCompletionCtx(model.id, () => completionsRef.current ?? null)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const sel = editor.getSelection()
      const text = sel && !sel.isEmpty() ? editor.getModel()?.getValueInRange(sel) ?? '' : ''
      // Whitespace-only selections count as "no selection" — run the whole tab.
      onRunRef.current(text.trim() ? text : undefined)
    })
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))
    editor.focus()
    return () => {
      sub.dispose()
      if (model) clearCompletionCtx(model.id)
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design (remount via key)
  }, [])

  return <div className="editor-host" ref={hostRef} />
}
