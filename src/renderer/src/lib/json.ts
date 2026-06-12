/** JSON.stringify that survives BigInt (rendered as exact digit strings)
 *  instead of throwing TypeError.
 *
 *  No driver hands the renderer a BigInt today — pg returns int8/numeric as
 *  exact strings, mysql2 (with supportBigNumbers) goes string past 2^53, and
 *  Mongo rows arrive EJSON-relaxed — so this is defense-in-depth: the grid,
 *  exports and inspector all degrade the same way if one ever does. */
export function jsonStringify(v: unknown, pretty = false): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), pretty ? 2 : undefined)
}
