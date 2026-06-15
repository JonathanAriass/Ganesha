export interface CodeBlock { lang: string; code: string }

/** Extract fenced ``` code blocks from markdown. Only closed fences count. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  // ```lang\n …code… \n``` — non-greedy body, language is the first fence word.
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    blocks.push({ lang: m[1].trim(), code: m[2].replace(/\n$/, '') })
  }
  return blocks
}
