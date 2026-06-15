import { describe, it, expect } from 'vitest'
import { MODEL_CATALOG } from './catalog'

describe('MODEL_CATALOG', () => {
  it('offers a few well-formed entries', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(2)
    for (const m of MODEL_CATALOG) {
      expect(m.id).toMatch(/.+/)
      expect(m.uri).toMatch(/^hf:/) // Hugging Face URI node-llama-cpp understands
      expect(m.name).toMatch(/.+/)
      expect(m.sizeLabel).toMatch(/.+/)
    }
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length) // unique ids
  })
})
