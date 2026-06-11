import { monaco } from './monaco'
import type { DbObject, ObjectRef, ColumnInfo } from '@shared/schema'
import {
  sqlPlainSuggestions,
  sqlDotQualifier,
  resolveSqlQualifier,
  columnSuggestions,
  schemaObjectSuggestions,
  mongoCursorContext,
  mongoCollectionSuggestions,
  mongoOpSuggestions,
  mongoDatabaseSuggestions,
  type Suggestion
} from './completions'

/** What an editor contributes to completions: its connection's objects and a
 *  lazy column fetch (QueryTab routes it through the schema tree's query cache). */
export interface CompletionCtx {
  objects: DbObject[]
  getColumns: (ref: ObjectRef) => Promise<ColumnInfo[]>
}

/** Monaco completion providers are language-global, not per-editor, so they are
 *  registered exactly once (below, at module load) and dispatch on the model that
 *  asked. Each editor registers a thunk here on mount and removes it on unmount;
 *  a thunk, not a value, so the provider always sees the latest React props. */
const ctxByModel = new Map<string, () => CompletionCtx | null>()

export function setCompletionCtx(modelId: string, get: () => CompletionCtx | null): void {
  ctxByModel.set(modelId, get)
}

export function clearCompletionCtx(modelId: string): void {
  ctxByModel.delete(modelId)
}

const KIND: Record<Suggestion['kind'], monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  table: monaco.languages.CompletionItemKind.Class,
  view: monaco.languages.CompletionItemKind.Interface,
  collection: monaco.languages.CompletionItemKind.Class,
  column: monaco.languages.CompletionItemKind.Field,
  database: monaco.languages.CompletionItemKind.Module,
  op: monaco.languages.CompletionItemKind.Method,
  snippet: monaco.languages.CompletionItemKind.Snippet
}

function toItems(sugs: Suggestion[], range: monaco.IRange): monaco.languages.CompletionItem[] {
  return sugs.map((s) => ({
    label: s.label,
    kind: KIND[s.kind],
    insertText: s.insertText,
    detail: s.detail,
    range,
    ...(s.isSnippet && {
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
    })
  }))
}

/** Range of the word being completed — what an accepted suggestion replaces. */
function wordRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const w = model.getWordUntilPosition(position)
  return new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn)
}

function textBefore(model: monaco.editor.ITextModel, position: monaco.Position): string {
  return model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  })
}

const EMPTY: monaco.languages.CompletionList = { suggestions: [] }

monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.'],
  async provideCompletionItems(model, position) {
    const ctx = ctxByModel.get(model.id)?.()
    if (!ctx) return EMPTY
    const range = wordRange(model, position)
    const qualifier = sqlDotQualifier(textBefore(model, position))
    if (qualifier === null) return { suggestions: toItems(sqlPlainSuggestions(ctx.objects), range) }
    const target = resolveSqlQualifier(model.getValue(), qualifier, ctx.objects)
    if (!target) return EMPTY
    if (target.type === 'schemaObjects') {
      return { suggestions: toItems(schemaObjectSuggestions(ctx.objects, target.schema), range) }
    }
    // Column fetch can fail (connection down) — no suggestions is the right degradation.
    const cols = await ctx.getColumns(target.ref).catch(() => [] as ColumnInfo[])
    return { suggestions: toItems(columnSuggestions(cols), range) }
  }
})

// The mongo shell editor runs in 'javascript' mode; these merge with (and outrank,
// being exact-prefix matches) the TS worker's generic suggestions.
monaco.languages.registerCompletionItemProvider('javascript', {
  triggerCharacters: ['.', '"', "'"],
  provideCompletionItems(model, position) {
    const ctx = ctxByModel.get(model.id)?.()
    if (!ctx) return EMPTY
    const cursor = mongoCursorContext(textBefore(model, position))
    if (!cursor) return EMPTY
    if (cursor.type === 'databases') {
      // Db names may contain '-', which splits Monaco's word — range over the
      // regex-captured partial instead so accepting replaces all of it.
      const range = new monaco.Range(
        position.lineNumber,
        position.column - cursor.partial.length,
        position.lineNumber,
        position.column
      )
      return { suggestions: toItems(mongoDatabaseSuggestions(ctx.objects), range) }
    }
    const range = wordRange(model, position)
    if (cursor.type === 'collections') {
      return { suggestions: toItems(mongoCollectionSuggestions(ctx.objects, cursor.database), range) }
    }
    return { suggestions: toItems(mongoOpSuggestions(), range) }
  }
})
