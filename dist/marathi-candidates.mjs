/** @file Conservative dictionary-assisted ranking of actual optical candidates. */
// Rank actual visual readings; never generate a replacement from a word list.
/** Read permitted entries from the bundled Marathi spelling dictionary. */
export function dictionaryWords(text) {
  return new Set(
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .slice(1)
      .filter((line) => line && !/[FXx]/.test(line.split("/")[1] || ""))
      .map((line) => line.split("/")[0].normalize("NFC")),
  );
}
/** Summarize visual character scores for candidate ranking, not calibrated accuracy. */
export function ctcConfidence(values, dims) {
  const classes = dims.at(-1),
    steps = dims.at(-2);
  let total = 0,
    count = 0,
    last = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0,
      score = -Infinity;
    for (let c = 0; c < classes; c++)
      if (values[t * classes + c] > score) {
        score = values[t * classes + c];
        best = c;
      }
    if (best && best !== last) {
      total += Math.log(Math.max(1e-9, Math.min(1, score)));
      count++;
    }
    last = best;
  }
  return count ? Math.exp(total / count) : 0;
}
/** Compute the code-point edit distance between two candidate readings. */
function editDistance(a, b) {
  a = [...a];
  b = [...b];
  let row = b.map((_, i) => i + 1);
  row.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}
/** Choose an unambiguous nearby dictionary-backed visual reading and retain alternatives. */
export function rankReadings(readings, dictionary) {
  const base = readings[0];
  if (!base) return { text: "", alternatives: [] };
  let winner = base;
  const word = /^[\u0900-\u0963\u0971-\u097f]+$/u;
  if (word.test(base.text) && !dictionary.has(base.text)) {
    const eligible = readings
        .slice(1)
        .filter(
          (r) =>
            word.test(r.text) &&
            dictionary.has(r.text) &&
            r.confidence >= 0.8 &&
            r.confidence >= base.confidence * 0.8 &&
            editDistance(base.text, r.text) <= 2,
        ),
      unique = new Set(eligible.map((r) => r.text));
    if (unique.size === 1)
      winner = eligible.reduce((a, b) => (a.confidence > b.confidence ? a : b));
  }
  const alternatives = [
    ...new Set(
      readings.map((r) => r.text).filter((t) => t && t !== winner.text),
    ),
  ].slice(0, 2);
  return { text: winner.text, alternatives };
}
