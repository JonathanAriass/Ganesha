import type { AwsInstance } from '@shared/domain'

/** How many matches the tunnel form's instance picker lists at once. */
export const INSTANCE_LIST_LIMIT = 50

/** The instances matching what was typed — by name, host name or id, every word required.
 *  A value that is exactly one instance's id is a made choice, not a search: the whole list
 *  comes back, so the picker can be reopened to choose a different one. */
export function filterInstances(instances: AwsInstance[], query: string): AwsInstance[] {
  const q = query.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length === 0 || instances.some((i) => i.instanceId.toLowerCase() === q)) return instances
  return instances.filter((i) => {
    const hay = `${i.name} ${i.host ?? ''} ${i.instanceId}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
