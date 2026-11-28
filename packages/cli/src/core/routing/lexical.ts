const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'use', 'when', 'with', 'you', 'your'
]);

export function routingTerms(input: string): string[] {
  return (input.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => !STOP_WORDS.has(term));
}

interface RoutingDocument {
  id: string;
  name: string;
  description: string;
}

// Okapi BM25 over the catalog visible at discovery time. A query with no
// matching terms abstains, and input order supplies a stable tie-breaker.
export function buildBm25(catalog: RoutingDocument[]): (query: string) => string | null {
  const documentFrequency = new Map<string, number>();
  const index = catalog.map(({ id, name, description }) => {
    const terms = routingTerms(`${name} ${description}`);
    const counts = new Map<string, number>();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    for (const term of counts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    return { id, counts, length: terms.length };
  });
  const averageLength = index.reduce((sum, doc) => sum + doc.length, 0) / index.length || 1;
  const idf = new Map([...documentFrequency].map(([term, frequency]) => [
    term, Math.log(1 + (index.length - frequency + 0.5) / (frequency + 0.5))
  ]));
  const k1 = 1.2;
  const b = 0.75;

  return (query) => {
    const terms = new Set(routingTerms(query));
    let bestId: string | null = null;
    let bestScore = 0;
    for (const { id, counts, length } of index) {
      let score = 0;
      const lengthPenalty = k1 * (1 - b + b * length / averageLength);
      for (const term of terms) {
        const frequency = counts.get(term) ?? 0;
        if (frequency === 0) continue;
        score += idf.get(term)! * (frequency * (k1 + 1)) / (frequency + lengthPenalty);
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    return bestId;
  };
}
