/**
 * Suggest a name for a snippet from its query text: the first non-empty line,
 * stripped of comment markers — a scratchpad that starts with a title comment
 * (`-- top customers`) is already telling us its name. Returns '' when there
 * is nothing usable; the save dialog then falls back to its placeholder.
 */
export function defaultSnippetName(query: string): string {
  for (const raw of query.split('\n')) {
    const line = raw
      .trim()
      .replace(/^(--|\/\/|\/\*+|#|\*+)\s*/, '') // `*+` also catches boxed-comment continuation lines
      .replace(/\s*\/\*.*\*\/$/, '') // balanced trailing comment: `select 1 /* count */`
      .replace(/\s*\*\/$/, '') // lone closer left by the leading strip: `/* title */`
      .trim()
    if (line) return line.slice(0, 60)
  }
  return ''
}
