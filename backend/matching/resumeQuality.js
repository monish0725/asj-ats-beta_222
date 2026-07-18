// Resume Quality is deliberately about how complete and parseable the resume itself is --
// NOT a judgment on the candidate. A brilliant candidate with a two-line resume still
// gets a low quality score here, which is correct: it means a recruiter should go back
// and ask for more detail, not that the candidate is weak.
export function scoreResumeQuality(candidate) {
  const text = String(candidate.resumeText || "");
  const length = text.trim().length;
  const reasons = [];
  let score = 0;

  if (length > 1200) score += 35;
  else if (length > 500) score += 25;
  else if (length > 150) score += 10;
  else reasons.push("Resume text is very short -- parsing may be incomplete.");

  if (candidate.email) score += 15; else reasons.push("No email on file.");
  if (candidate.phone) score += 10;
  if (candidate.location) score += 10;
  if ((candidate.skills || []).length >= 3) score += 20;
  else reasons.push("Very few skills listed.");
  if (candidate.currentRole) score += 10;

  // Garbled-extraction guard: a very high ratio of non-alphanumeric characters usually
  // means a PDF-to-text conversion mangled the resume rather than the candidate writing
  // gibberish, so it's flagged as a quality problem rather than silently scored low.
  const alnumRatio = length ? (text.replace(/[^a-zA-Z0-9]/g, "").length / length) : 0;
  if (length > 50 && alnumRatio < 0.5) {
    score = Math.min(score, 30);
    reasons.push("Resume text looks garbled -- extraction quality may be poor.");
  }

  return { score: Math.min(100, score), reasons };
}
