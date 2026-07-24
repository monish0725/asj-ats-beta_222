import { writeFileSync } from "node:fs";

const apiBaseUrl = String(
  process.env.ASJ_ATS_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.REACT_APP_API_URL ||
  ""
).replace(/\/+$/, "");

writeFileSync(
  "public/config.js",
  `window.ASJ_ATS_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`
);

console.log(`Wrote public/config.js with API base: ${apiBaseUrl || "same-origin"}`);
