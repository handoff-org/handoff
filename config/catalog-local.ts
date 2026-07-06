import type { HandoffModelEntry, QuantOption } from './catalog-types.js';
import { Q4, Q5, Q8, FP16, MLX4, MLX8 } from './catalog-types.js';

const GGUF: QuantOption[] = [Q4, Q5, Q8, FP16];
const MLX: QuantOption[] = [MLX4, MLX8];

/** llama.cpp GGUF models. Quant lives in the file name; prefer Q4_K_M. */
export const LLAMA_CPP_CATALOG: HandoffModelEntry[] = [
  g('Qwen3-4B-Instruct-Q4_K_M', 'Qwen3-4B', 'qwen', 'small', 4, ['fast_cool', 'tool_use'], 5, 3, 'recommended'),
  g('Qwen3-8B-Instruct-Q4_K_M', 'Qwen3-8B', 'qwen', 'small', 8, ['default', 'tool_use', 'coding_agent'], 5, 4, 'recommended'),
  g('Qwen3-14B-Instruct-Q4_K_M', 'Qwen3-14B', 'qwen', 'medium', 14, ['coding_agent', 'tool_use'], 5, 4, 'recommended'),
  g('Qwen3-Coder-30B-A3B-Instruct-Q4_K_M', 'Qwen3-Coder-30B', 'qwen', 'large', 30, ['coding_agent'], 5, 5, 'advanced', 3),
  g('gpt-oss-20b-Q4_K_M', 'gpt-oss-20b', 'gpt_oss', 'large', 20, ['tool_use', 'structured_output'], 5, 4, 'advanced'),
  g('gemma-3-12b-it-Q4_K_M', 'Gemma-3-12B', 'gemma', 'medium', 12, ['research_writing'], 3, 3, 'recommended'),
  g('DeepSeek-R1-Distill-Qwen-14B-Q4_K_M', 'DeepSeek-R1-14B', 'deepseek', 'medium', 14, ['reasoning_verifier'], 3, 3, 'advanced'),
  g('Ornith-1.0-9B-GGUF', 'Ornith-9B', 'ornith', 'small', 9, ['coding_agent', 'tool_use', 'fast_cool'], 4, 5, 'recommended'),
  g('Ornith-1.0-35B-GGUF', 'Ornith-35B', 'ornith', 'large', 35, ['coding_agent'], 4, 5, 'advanced', 3),
];

/** MLX (Apple Silicon) models. Prefer 4-bit repos. */
export const MLX_CATALOG: HandoffModelEntry[] = [
  m('mlx-community/Qwen3-4B-4bit', 'Qwen3-4B', 'qwen', 'small', 4, ['fast_cool', 'tool_use'], 5, 3, 'recommended'),
  m('mlx-community/Qwen3-8B-4bit', 'Qwen3-8B', 'qwen', 'small', 8, ['default', 'tool_use', 'coding_agent'], 5, 4, 'recommended'),
  m('mlx-community/Qwen3-14B-4bit', 'Qwen3-14B', 'qwen', 'medium', 14, ['coding_agent', 'tool_use'], 5, 4, 'recommended'),
  m('mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit', 'Qwen3-Coder-30B', 'qwen', 'large', 30, ['coding_agent'], 5, 5, 'advanced', 3),
  m('mlx-community/gpt-oss-20b-MXFP4-Q4', 'gpt-oss-20b', 'gpt_oss', 'large', 20, ['tool_use', 'structured_output'], 5, 4, 'advanced'),
  m('mlx-community/gemma-3-12b-it-4bit', 'Gemma-3-12B', 'gemma', 'medium', 12, ['research_writing'], 3, 3, 'recommended'),
  m('mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit', 'DeepSeek-R1-14B', 'deepseek', 'medium', 14, ['reasoning_verifier'], 3, 3, 'advanced'),
];

function base(
  id: string, backend: HandoffModelEntry['backend'], label: string,
  family: HandoffModelEntry['family'], sizeClass: HandoffModelEntry['sizeClass'],
  totalParamsB: number, roles: HandoffModelEntry['roles'], quantOptions: QuantOption[],
  defaultQuant: HandoffModelEntry['defaultQuant'], toolUseScore: HandoffModelEntry['toolUseScore'],
  codingScore: HandoffModelEntry['codingScore'], maturity: HandoffModelEntry['maturity'],
  activeParamsB?: number,
): HandoffModelEntry {
  const small = totalParamsB <= 14;
  return {
    id, backend, label, family, roles, privacy: 'self_hosted',
    sizeClass, totalParamsB, ...(activeParamsB ? { activeParamsB } : {}),
    quantOptions, defaultQuant,
    defaultContextTokens: small ? 8192 : 8192, 
    safeContextTokens: small ? 4096 : 8192, 
    maxContextTokens: 32768,
    minUnifiedMemoryGb: totalParamsB <= 8 ? 8 : totalParamsB <= 14 ? 16 : 24,
    recommendedUnifiedMemoryGb: totalParamsB <= 8 ? 16 : totalParamsB <= 14 ? 24 : 32,
    minimumMacTier: totalParamsB <= 14 ? 'apple_silicon' : 'pro',
    heatRisk: totalParamsB <= 8 ? 'low' : totalParamsB <= 14 ? 'medium' : 'high',
    maturity,
    toolUseScore, 
    codingScore, 
    reasoningScore: 4, 
    writingScore: 4,
    speedScore: totalParamsB <= 8 ? 4 : totalParamsB <= 14 ? 3 : 2,
    notes: 'Local server backend — the server must be running before use.',
  };
}
function g(
  id: string, 
  label: string, 
  family: HandoffModelEntry['family'], 
  sizeClass: HandoffModelEntry['sizeClass'], 
  p: number, 
  roles: HandoffModelEntry['roles'], 
  t: HandoffModelEntry['toolUseScore'], 
  c: HandoffModelEntry['codingScore'], 
  mat: HandoffModelEntry['maturity'], 
  a?: number
) {
  return base(id, 'llama_cpp', label, family, sizeClass, p, roles, GGUF, 'q4_K_M', t, c, mat, a);
}
function m(
  id: string, 
  label: string, 
  family: HandoffModelEntry['family'], 
  sizeClass: HandoffModelEntry['sizeClass'], 
  p: number, 
  roles: HandoffModelEntry['roles'], 
  t: HandoffModelEntry['toolUseScore'], 
  c: HandoffModelEntry['codingScore'], 
  mat: HandoffModelEntry['maturity'], 
  a?: number
) {
  return base(
    id, 'mlx', label, family, sizeClass, p, 
    roles, MLX, 'mlx_4bit', t, c, mat, a
  );
}
