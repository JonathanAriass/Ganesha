import { useEffect, useRef } from 'react'
import { monaco } from '../lib/monaco'

interface Props {
  initialValue: string
  language: string
  onChange: (text: string) => void
  onRun: () => void
}

/** Mount-once Monaco instance; parents remount it (via key) to replace content. */
export default function MonacoEditor({ initialValue, language, onChange, onRun }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const editor = monaco.editor.create(host, {
      value: initialValue,
      language,
      theme: 'midnight',
      minimap: { enabled: false },
      fontSize: 13,
      // Installs a per-editor resize watcher — deliberate while editor instances are few; revisit if tab counts grow.
      automaticLayout: true,
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      tabSize: 2
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current())
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))
    editor.focus()
    return () => {
      sub.dispose()
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design (remount via key)
  }, [])

  return <div className="editor-host" ref={hostRef} />
}
