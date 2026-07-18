// Semantic similarity between the full resume and the job description, using real text
// embeddings when an embeddings provider is configured. When it isn't, this returns a
// status of "unavailable" rather than making up a number -- the score aggregator is
// responsible for redistributing this component's weight across the others when that
// happens, so the final score still adds up to something meaningful instead of silently
// scoring a candidate lower just because semantic matching wasn't configured.
async function callCohereEmbed(texts) {
  const response = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.COHERE_EMBED_MODEL || "embed-english-v3.0",
      texts,
      input_type: "clustering",
      embedding_types: ["float"]
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  return result.embeddings?.float || result.embeddings;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function matchSemantic(candidate, job) {
  if (!process.env.COHERE_API_KEY) {
    return { score: null, status: "unavailable", reason: "No embeddings provider configured (COHERE_API_KEY not set)." };
  }

  const resumeText = String(candidate.resumeText || "").slice(0, 4000);
  const jobText = `${job.title || ""}\n${job.description || ""}`.slice(0, 4000);
  if (!resumeText.trim() || !jobText.trim()) {
    return { score: null, status: "unavailable", reason: "Not enough text to compare." };
  }

  try {
    const [resumeEmbedding, jobEmbedding] = await callCohereEmbed([resumeText, jobText]);
    const similarity = cosineSimilarity(resumeEmbedding, jobEmbedding); // -1..1, but text embeddings are practically always 0..1
    const score = Math.round(Math.max(0, Math.min(1, similarity)) * 100);
    return { score, status: "ok" };
  } catch (error) {
    return { score: null, status: "error", reason: String(error.message || error).slice(0, 200) };
  }
}
