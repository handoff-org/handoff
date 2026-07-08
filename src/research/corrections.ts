/**
 * The instruction sent to the model for a /research turn. It carries the full
 * corrections workflow so the default chat system prompt doesn't need swapping;
 * the user only sees their claim in the transcript.
 */
export function correctionsDirective(claim: string): string {
  return [
    'You are in CORRECTIONS mode. Fact-check the claim below against the scholarly literature.',
    '',
    'Use the research tools:',
    '- search_papers(query): find peer-reviewed work. Search for BOTH supporting evidence AND',
    '  disconfirming evidence — also try terms like "no effect", "fails to replicate",',
    '  "contradicts", "limitations", "null result".',
    "- get_paper(id): read a paper's full abstract before you rely on or cite it.",
    '',
    'Then answer with:',
    '1. The claim split into 1–3 atomic, checkable sub-claims.',
    '2. For each sub-claim: the supporting and the contradicting evidence you found.',
    '3. A final verdict in **bold**: SUPPORTED / CONTESTED / REFUTED / UNCLEAR, with a one-line rationale.',
    '4. A short reference list — `Author Year (venue, N citations) — "short quote" [doi or id]`.',
    '   Only cite papers you actually fetched with get_paper. Never invent citations or numbers.',
    '   If the evidence is thin or absent, say UNCLEAR rather than guessing.',
    '',
    `Claim: ${claim}`,
  ].join('\n');
}
