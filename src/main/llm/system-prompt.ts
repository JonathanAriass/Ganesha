/** Assemble the chat system prompt as an explicit two-step protocol: read the live DATABASE TABLES
 *  first (the authoritative source for every table/column name), THEN the linked REPOSITORY CODE
 *  (relationships, enums, intent only). Tables-first plus a last-word precedence rule naming the exact
 *  focus tables stops the model from copying table names out of the repo's class/migration names
 *  (e.g. a `User` class → table `02_users`). With no repo it's just the intro + schema, as before. */
export function buildSystemPrompt(
  dialect: string,
  schemaText: string,
  repoText: string,
  focusTables: string[] = []
): string {
  const lang = dialect === 'mongodb' ? 'js' : 'sql'
  const intro =
    `You are a database query assistant for a ${dialect} database. ` +
    `Write correct, runnable queries in fenced code blocks (\`\`\`${lang}). Be concise.`

  if (!repoText.trim()) {
    return `${intro}\n\n${schemaText}`
  }

  const focusRule = focusTables.length
    ? ` For this question the relevant table(s) are exactly: ${focusTables.map((t) => `\`${t}\``).join(', ')}.`
    : ''

  return [
    intro,
    'Read the two sections below IN ORDER.',
    `STEP 1 — DATABASE TABLES (from the live connection; the ONLY source of truth for table and column names):\n\n${schemaText}`,
    `STEP 2 — LINKED REPOSITORY CODE (use only for relationships, enums and intent — the names here may differ from the database):\n\n${repoText}`,
    `Take every table and column name from STEP 1. The code in STEP 2 may abbreviate or rename them (e.g. a \`User\` class maps to the table \`02_users\`); never put a name in your query that is not in STEP 1.${focusRule}`
  ].join('\n\n')
}
