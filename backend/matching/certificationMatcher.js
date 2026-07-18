// Known certification phrases, grouped by vendor. Matching on phrases rather than single
// keywords avoids false positives (e.g. the word "associate" alone means nothing, but
// "aws certified solutions architect associate" is unambiguous).
const CERTIFICATIONS = [
  { vendor: "AWS", phrases: ["aws certified", "aws solutions architect", "aws developer associate", "aws sysops"] },
  { vendor: "Microsoft Azure", phrases: ["azure certified", "azure fundamentals", "az-900", "az-104", "az-204", "azure solutions architect", "azure administrator"] },
  { vendor: "Google Cloud", phrases: ["google cloud certified", "google cloud professional", "gcp certified", "associate cloud engineer"] },
  { vendor: "Oracle", phrases: ["oracle certified", "ocp", "oracle database certified"] },
  { vendor: "Cisco", phrases: ["ccna", "ccnp", "cisco certified"] },
  { vendor: "CompTIA", phrases: ["comptia a+", "comptia network+", "comptia security+", "comptia"] },
  { vendor: "PMI", phrases: ["pmp", "project management professional", "capm"] },
  { vendor: "Scrum/Agile", phrases: ["certified scrum master", "csm certified", "psm i", "safe agilist"] },
  { vendor: "Kubernetes", phrases: ["cka", "ckad", "certified kubernetes"] },
  { vendor: "Salesforce", phrases: ["salesforce certified"] },
  { vendor: "Data/AI", phrases: ["tensorflow developer certificate", "deep learning specialization", "data science professional certificate"] }
];

// Cloud-vendor certs are weighted a little higher for the general case since they're the
// most commonly relevant across modern software roles; this is a coarse default, not a
// per-job customization -- a network/security job would ideally weigh Cisco higher, but
// that level of per-role vendor weighting isn't worth the complexity it'd add here.
const VENDOR_WEIGHT = { "AWS": 1, "Microsoft Azure": 1, "Google Cloud": 1, "Oracle": 0.8, "Cisco": 0.8, "CompTIA": 0.7, "PMI": 0.7, "Scrum/Agile": 0.7, "Kubernetes": 0.9, "Salesforce": 0.7, "Data/AI": 0.9 };

export function matchCertifications(candidate) {
  const text = String(candidate.resumeText || candidate.certifications || "").toLowerCase();
  const found = [];
  for (const { vendor, phrases } of CERTIFICATIONS) {
    const hit = phrases.some((phrase) => text.includes(phrase));
    if (hit) found.push(vendor);
  }
  if (!found.length) return { score: 0, certifications: [] };

  const weightedCount = found.reduce((sum, vendor) => sum + (VENDOR_WEIGHT[vendor] ?? 0.7), 0);
  // Diminishing returns: first relevant cert counts most, score saturates rather than
  // scaling linearly forever with an unrealistically long certification list.
  const score = Math.min(100, Math.round(100 * (1 - Math.exp(-0.7 * weightedCount))));
  return { score, certifications: found };
}
