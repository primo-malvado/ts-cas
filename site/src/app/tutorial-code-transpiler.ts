const MAX_SOURCE_LENGTH = 10_000;

const restrictedNames = new Set([
  "AsyncFunction",
  "BroadcastChannel",
  "EventSource",
  "Function",
  "RTCPeerConnection",
  "SharedWorker",
  "WebSocket",
  "WebSocketStream",
  "Worker",
  "WebTransport",
  "XMLHttpRequest",
  "caches",
  "close",
  "constructor",
  "document",
  "eval",
  "fetch",
  "globalThis",
  "importScripts",
  "indexedDB",
  "location",
  "module",
  "navigator",
  "parent",
  "postMessage",
  "process",
  "require",
  "self",
  "top",
  "window",
]);

type TypeScriptCompiler = typeof import("typescript");

declare global {
  interface Window {
    ts?: TypeScriptCompiler;
  }
}

let compilerPromise: Promise<TypeScriptCompiler> | undefined;

function loadTypeScriptCompiler(): Promise<TypeScriptCompiler> {
  if (window.ts) return Promise.resolve(window.ts);
  if (compilerPromise) return compilerPromise;

  const load = new Promise<TypeScriptCompiler>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = new URL("vendor/typescript/typescript.js", document.baseURI).toString();
    script.setAttribute("data-ts-cas-compiler", "true");
    script.onload = () => {
      if (window.ts) {
        resolve(window.ts);
      } else {
        reject(new Error("The TypeScript compiler loaded without exposing its API."));
      }
    };
    script.onerror = () => reject(new Error("Could not load the local TypeScript compiler."));
    document.head.append(script);
  });

  compilerPromise = load.catch((error: unknown) => {
    compilerPromise = undefined;
    throw error;
  });
  return compilerPromise;
}

function assertRestrictedSyntaxAbsent(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
): void {
  const visit = (node: import("typescript").Node): void => {
    if (
      ts.isImportDeclaration(node)
      || ts.isExportDeclaration(node)
      || ts.isImportTypeNode(node)
      || ts.isExportAssignment(node)
      || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      || (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)
      || (ts.canHaveModifiers(node)
        && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
    ) {
      throw new Error("Imports and exports are not available in cells. Use the tsCas namespace.");
    }

    if (ts.isIdentifier(node) && restrictedNames.has(node.text)) {
      throw new Error(`Access to '${node.text}' is disabled in the sandbox.`);
    }

    if (ts.isStringLiteralLike(node) && restrictedNames.has(node.text)) {
      throw new Error(`Access to '${node.text}' is disabled in the sandbox.`);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

export async function transpileTutorialCode(
  source: string,
  compiler?: TypeScriptCompiler,
): Promise<string> {
  if (!source.trim()) {
    throw new Error("Enter code before running this cell.");
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new Error(`Code exceeds the ${MAX_SOURCE_LENGTH}-character limit.`);
  }

  const ts = compiler ?? await loadTypeScriptCompiler();
  const sourceFile = ts.createSourceFile(
    "tutorial-cell.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assertRestrictedSyntaxAbsent(ts, sourceFile);

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
    },
    fileName: "tutorial-cell.ts",
    reportDiagnostics: true,
  });
  const error = transpiled.diagnostics?.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (error) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, "\n");
    throw new Error(`Could not compile TypeScript: ${message}`);
  }

  return transpiled.outputText;
}
