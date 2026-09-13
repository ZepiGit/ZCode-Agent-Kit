// Scoped edits to existing structured config files.
//
// These helpers edit configuration textually but contextually: a change only
// ever touches lines that belong to the targeted key, and the result is
// re-validated by the caller. The regression this exists for: the first
// implementation used the global regex /^[ \t]*- zcode[ \t]*$\n?/gm, which
// removed `- zcode` from ANY list — including unrelated user lists.

/**
 * Remove one entry from a top-level `disabledProviders:` list.
 *
 * Only list items directly under that key are affected; lists under other
 * keys keep an identical `- zcode` entry. Returns
 * { text, removed } — `text` is the original reference when nothing matched.
 */
export function removeFromDisabledProviders(yamlText, entry) {
  const lines = yamlText.split("\n");
  const out = [];
  let inDisabled = false;
  let removed = 0;
  for (const line of lines) {
    // A new top-level key always ends the previous list.
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*(#.*)?$/.test(line)) {
      inDisabled = line.startsWith("disabledProviders:");
    } else if (inDisabled && /^[ \t]*#|^[ \t]*$/.test(line)) {
      // comments and blank lines inside the list: keep, stay in the list
    } else if (inDisabled && /^[ \t]+[A-Za-z_][A-Za-z0-9_-]*:\s*(#.*)?$/.test(line)) {
      inDisabled = false; // nested map under disabledProviders: list over
    } else if (inDisabled && /^[ \t]*- /.test(line)) {
      const value = line.replace(/#.*$/, "").trim();
      if (value === `- ${entry}`) {
        removed += 1;
        continue; // drop the line entirely
      }
    } else if (inDisabled && /\S/.test(line)) {
      inDisabled = false;
    }
    out.push(line);
  }
  return removed > 0 ? { text: out.join("\n"), removed } : { text: yamlText, removed: 0 };
}
