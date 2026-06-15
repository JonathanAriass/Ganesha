import type { CatalogModel } from '../../shared/domain'

/** A small curated set of local, SQL-capable instruct models (GGUF, quantized).
 *  Advanced users can also paste any `hf:org/repo:quant` URI in the UI. The URI
 *  format is the one node-llama-cpp's downloader accepts (verified in the spike). */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'qwen2.5-coder-0.5b-q4',
    name: 'Qwen2.5 Coder 0.5B (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~0.4 GB',
    description: 'Tiny & fast — runs anywhere. Good for trying it out and simple queries.'
  },
  {
    id: 'qwen2.5-coder-1.5b-q4',
    name: 'Qwen2.5 Coder 1.5B (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~1.1 GB',
    description: 'Small and quick; noticeably better SQL than 0.5B.'
  },
  {
    id: 'qwen2.5-coder-7b-q4',
    name: 'Qwen2.5 Coder 7B (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~4.7 GB',
    description: 'Best quality/size balance for SQL. Needs ~8 GB free RAM.'
  },
  {
    id: 'llama3.1-8b-q4',
    name: 'Llama 3.1 8B Instruct (Q4_K_M)',
    uri: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~4.9 GB',
    description: 'General-purpose; strong reasoning. Needs ~8 GB free RAM.'
  }
]
