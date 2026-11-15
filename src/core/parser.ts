import { add, fn, integer, mul, pow, rational, symbol, type Expr } from "./expr.js";

type Token = { type: "number" | "identifier" | "operator" | "eof"; value: string; pos: number };

/** Tokenizes decimal literals, including scientific notation, without binary-float conversion. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      const start = i;
      while (/[0-9]/.test(input[i] ?? "")) i++;
      if (input[i] === ".") {
        i++;
        while (/[0-9]/.test(input[i] ?? "")) i++;
      }
      // Consume scientific notation only when e/E is followed by a valid exponent.
      // This keeps `2E` as multiplication by the Euler constant, while `2E-3`
      // is parsed as the exact rational 0.002.
      if (input[i] === "e" || input[i] === "E") {
        let exponentEnd = i + 1;
        if (input[exponentEnd] === "+" || input[exponentEnd] === "-") exponentEnd++;
        const digitStart = exponentEnd;
        while (/[0-9]/.test(input[exponentEnd] ?? "")) exponentEnd++;
        if (exponentEnd > digitStart) i = exponentEnd;
      }
      tokens.push({ type: "number", value: input.slice(start, i), pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i++;
      while (/[A-Za-z0-9_]/.test(input[i] ?? "")) i++;
      tokens.push({ type: "identifier", value: input.slice(start, i), pos: start });
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ type: "operator", value: c, pos: i++ });
      continue;
    }
    throw new SyntaxError(`Unexpected character '${c}' at position ${i}.`);
  }
  tokens.push({ type: "eof", value: "", pos: input.length });
  return tokens;
}

const FUNCTIONS = new Set(["sin", "cos", "tan", "atan", "exp", "log", "ln", "sqrt", "cbrt", "abs", "sign"]);

function parseExpression(input: string, preserveStructure: boolean): Expr {
  const makeAdd = (...terms: Expr[]): Expr =>
    preserveStructure ? { kind: "Add", terms } : add(...terms);
  const makeMul = (...factors: Expr[]): Expr =>
    preserveStructure ? { kind: "Mul", factors } : mul(...factors);
  const makePow = (base: Expr, exponent: Expr): Expr =>
    preserveStructure ? { kind: "Pow", base, exponent } : pow(base, exponent);
  const makeFunction = (name: string, ...args: Expr[]): Expr =>
    preserveStructure ? { kind: "Function", name, args } : fn(name, ...args);
  const tokens = tokenize(input);
  let index = 0;
  const peek = () => tokens[index]!;
  const take = () => tokens[index++]!;
  const expect = (value: string) => {
    const t = take();
    if (t.value !== value) throw new SyntaxError(`Expected '${value}' at position ${t.pos}.`);
  };
  const startsPrimary = (t: Token) =>
    t.type === "number" || t.type === "identifier" || t.value === "(";

  function expression(minBindingPower = 0): Expr {
    let token = take();
    let left: Expr;

    if (token.type === "number") {
      const exponentMarker = token.value.search(/[eE]/);
      const mantissa = exponentMarker >= 0 ? token.value.slice(0, exponentMarker) : token.value;
      const exponent = exponentMarker >= 0 ? Number(token.value.slice(exponentMarker + 1)) : 0;
      if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) {
        throw new RangeError("Scientific-notation exponent must be between -10000 and 10000.");
      }
      if (mantissa.includes(".")) {
        const [whole, fractional = ""] = mantissa.split(".");
        const digits = BigInt((whole || "0") + fractional);
        const scale = fractional.length - exponent;
        left = scale >= 0
          ? rational(digits, 10n ** BigInt(scale))
          : integer(digits * (10n ** BigInt(-scale)));
      } else {
        const digits = BigInt(mantissa);
        left = exponent >= 0
          ? integer(digits * (10n ** BigInt(exponent)))
          : rational(digits, 10n ** BigInt(-exponent));
      }
    } else if (token.type === "identifier") {
      if (token.value === "pi") left = symbol("pi");
      else if (token.value === "E") left = symbol("E");
      else if (FUNCTIONS.has(token.value) && peek().value === "(") {
        take();
        const args: Expr[] = [];
        if (peek().value !== ")") {
          args.push(expression());
          while (peek().value === ",") { take(); args.push(expression()); }
        }
        expect(")");
        left = makeFunction(token.value, ...args);
      } else left = symbol(token.value);
    } else if (token.value === "(") {
      left = expression();
      expect(")");
    } else if (token.value === "+") {
      left = expression(25);
    } else if (token.value === "-") {
      left = makeMul(integer(-1), expression(25));
    } else {
      throw new SyntaxError(`Unexpected token '${token.value}' at position ${token.pos}.`);
    }

    while (true) {
      const next = peek();
      if (next.value === "(" && left.kind === "Symbol" && FUNCTIONS.has(left.name)) {
        const bp = 40;
        if (bp < minBindingPower) break;
        take();
        const args: Expr[] = [];
        if (peek().value !== ")") {
          args.push(expression());
          while (peek().value === ",") { take(); args.push(expression()); }
        }
        expect(")");
        left = makeFunction(left.name, ...args);
        continue;
      }

      let op = next.value;
      let lbp = -1, rbp = -1;
      if (op === "+" || op === "-") { lbp = 10; rbp = 11; }
      else if (op === "*" || op === "/") { lbp = 20; rbp = 21; }
      else if (op === "^") { lbp = 30; rbp = 30; }
      else if (startsPrimary(next)) { op = "*"; lbp = 20; rbp = 21; }
      if (lbp < minBindingPower) break;
      if (next.value === "*" || next.value === "/" || next.value === "+" || next.value === "-" || next.value === "^") take();

      const right = expression(rbp);
      if (op === "+") left = makeAdd(left, right);
      else if (op === "-") left = makeAdd(left, makeMul(integer(-1), right));
      else if (op === "*") left = makeMul(left, right);
      else if (op === "/") left = makeMul(left, makePow(right, integer(-1)));
      else if (op === "^") left = makePow(left, right);
    }
    return left;
  }

  const result = expression();
  if (peek().type !== "eof") throw new SyntaxError(`Unexpected token '${peek().value}' at position ${peek().pos}.`);
  return result;
}

/** Parse using canonical constructors, preserving the existing parser behavior. */
export function parse(input: string): Expr {
  return parseExpression(input, false);
}

/**
 * Parse without algebraically combining terms or cancelling factors. Intended
 * for domain analysis, where the original syntax can contain restrictions
 * that canonicalization would erase.
 */
export function parsePreservingStructure(input: string): Expr {
  return parseExpression(input, true);
}
