const KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "false",
  "for",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "while",
]);

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function highlightTutorialCode(source: string): string {
  const tokenPattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:tsCas)\b|\b(?:[A-Za-z_$][\w$]*)\b|\b(?:\d+(?:\.\d+)?)\b)/g;

  let result = "";
  let index = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const start = match.index ?? 0;
    result += escapeHtml(source.slice(index, start));

    const token = match[0];
    let className: string | null = null;

    if (token.startsWith("//") || token.startsWith("/*")) {
      className = "syntax-comment";
    } else if (
      token.startsWith("\"")
      || token.startsWith("'")
      || token.startsWith("`")
    ) {
      className = "syntax-string";
    } else if (KEYWORDS.has(token)) {
      className = "syntax-keyword";
    } else if (/^\d/.test(token)) {
      className = "syntax-number";
    } else if (token === "tsCas") {
      className = "syntax-library";
    }

    result += className
      ? `<span class="${className}">${escapeHtml(token)}</span>`
      : escapeHtml(token);
    index = start + token.length;
  }

  result += escapeHtml(source.slice(index));
  return result.endsWith("\n") ? result : `${result}\n`;
}
