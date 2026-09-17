// Value spans keep edits outside the replaced subtree byte-identical.
function document(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = () => { throw new SyntaxError(`invalid JSONC at offset ${i}`); };
  function space() {
    for (;;) {
      while (/\s/.test(text[i] ?? "") && i < text.length) i += 1;
      if (text.startsWith("//", i)) {
        while (i < text.length && !"\r\n".includes(text[i])) i += 1;
      } else if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) fail();
        i = end + 2;
      } else return;
    }
  }
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    fail();
  }
  function value() {
    space();
    const start = i;
    if (text[i] === "{" || text[i] === "[") {
      const object = text[i++] === "{";
      const close = object ? "}" : "]";
      const result = object ? {} : [];
      const properties = [];
      const keys = new Set();
      let trailingComma = false;
      space();
      while (text[i] !== close) {
        if (i >= text.length) fail();
        let key;
        if (object) {
          if (text[i] !== '"') fail();
          key = string();
          if (keys.has(key)) throw new SyntaxError(`duplicate JSONC key: ${key}`);
          keys.add(key);
          space();
          if (text[i++] !== ":") fail();
        }
        const child = value();
        if (object) {
          Object.defineProperty(result, key, { value: child.value, enumerable: true, writable: true, configurable: true });
          properties.push({ key, ...child });
        } else result.push(child.value);
        space();
        trailingComma = text[i] === ",";
        if (trailingComma) { i += 1; space(); }
        else if (text[i] !== close) fail();
      }
      const closeAt = i++;
      return { value: result, start, end: i, closeAt, properties: object ? properties : undefined, trailingComma };
    }
    if (text[i] === '"') return { value: string(), start, end: i };
    const token = text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) fail();
    i += token.length;
    return { value: JSON.parse(token), start, end: i };
  }
  const root = value();
  space();
  if (i !== text.length) fail();
  return root;
}

export function parseJsonc(text) {
  return document(text).value;
}

export function setTopLevelKey(text, key, value) {
  const root = document(text);
  if (!root.properties) throw new Error("JSONC: top-level object required");
  const rendered = JSON.stringify(value, null, 2);
  if (rendered === undefined) throw new TypeError("JSONC value must be JSON-serializable");
  const existing = root.properties.find(p => p.key === key);
  if (existing) return text.slice(0, existing.start) + rendered + text.slice(existing.end);
  const last = root.properties.at(-1);
  let before = text.slice(0, root.closeAt);
  if (last && !root.trailingComma) before = before.slice(0, last.end) + "," + before.slice(last.end);
  return before + `\n  ${JSON.stringify(key)}: ${rendered}\n` + text.slice(root.closeAt);
}
