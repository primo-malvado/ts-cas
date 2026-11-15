import * as tsCas from "ts-cas";
import type {
  TutorialRunnerRequest,
  TutorialRunnerResponse,
} from "./tutorial-runner-protocol";

interface RunnerWorkerScope {
  onmessage: ((event: MessageEvent<TutorialRunnerRequest>) => void) | null;
  postMessage(message: TutorialRunnerResponse): void;
}

type AsyncFunctionConstructor = new (
  ...parameters: string[]
) => (...arguments_: unknown[]) => Promise<unknown>;

const workerScope = globalThis as unknown as RunnerWorkerScope;
const sendToParent = workerScope.postMessage.bind(workerScope);
const MAX_OUTPUT_LENGTH = 20_000;
const MAX_OUTPUT_LINES = 100;

function asMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return `${value}n`;
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue: unknown) =>
        typeof nestedValue === "bigint" ? `${nestedValue}n` : nestedValue,
      2,
    ) ?? String(value);
  } catch (error) {
    return `[Could not format the result: ${asMessage(error)}]`;
  }
}

function disableBrowserAndNetworkAccess(): void {
  const blocked = (): never => {
    throw new Error("Network and browser APIs are disabled in code cells.");
  };

  for (const name of [
    "BroadcastChannel",
    "EventSource",
    "SharedWorker",
    "RTCPeerConnection",
    "WebSocket",
    "WebSocketStream",
    "Worker",
    "WebTransport",
    "XMLHttpRequest",
    "caches",
    "fetch",
    "importScripts",
    "indexedDB",
    "postMessage",
  ]) {
    if (!Reflect.defineProperty(globalThis, name, {
      value: blocked,
      configurable: false,
      writable: false,
    })) {
      throw new Error(`Could not disable the '${name}' API in this sandbox.`);
    }
  }
}

function disableDynamicCodeGeneration(): void {
  for (const prototype of [
    Object.getPrototypeOf(function () {}),
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ]) {
    if (!Reflect.defineProperty(prototype, "constructor", {
      value: undefined,
      configurable: false,
      writable: false,
    })) {
      throw new Error("Could not disable dynamic code generation.");
    }
  }

  for (const name of ["eval", "Function"]) {
    if (!Reflect.defineProperty(globalThis, name, {
      value: undefined,
      configurable: false,
      writable: false,
    })) {
      throw new Error(`Could not disable '${name}' in the sandbox.`);
    }
  }
}

workerScope.onmessage = async (event): Promise<void> => {
  if (event.data?.type !== "run" || typeof event.data.source !== "string") {
    sendToParent({ type: "error", message: "Invalid execution request." });
    return;
  }

  const source = event.data.source;
  if (source.length > 10_000) {
    sendToParent({ type: "error", message: "Code exceeds the 10,000-character limit." });
    return;
  }
  if (/\bimport\b/.test(source)) {
    sendToParent({ type: "error", message: "Imports are not available in cells. Use the tsCas namespace." });
    return;
  }

  try {
    const output: string[] = [];
    let outputLength = 0;
    let truncated = false;
    const appendOutput = (...values: unknown[]): void => {
      if (output.length >= MAX_OUTPUT_LINES || outputLength >= MAX_OUTPUT_LENGTH) {
        truncated = true;
        return;
      }

      const line = values.map(formatValue).join(" ");
      const remaining = MAX_OUTPUT_LENGTH - outputLength;
      const boundedLine = line.slice(0, remaining);
      output.push(boundedLine);
      outputLength += boundedLine.length;
      if (boundedLine.length < line.length) truncated = true;
    };
    const cellConsole = Object.freeze({
      log: appendOutput,
      info: appendOutput,
      warn: appendOutput,
      error: appendOutput,
    });

    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as AsyncFunctionConstructor;
    const execute = new AsyncFunction("tsCas", "console", `"use strict";\n${source}`);
    disableBrowserAndNetworkAccess();
    disableDynamicCodeGeneration();

    const result = await execute(Object.freeze({ ...tsCas }), cellConsole);
    if (result !== undefined) appendOutput(result);
    if (truncated) output.push("[Output truncated: line or character limit reached.]");

    sendToParent({
      type: "complete",
      output: output.length > 0 ? output.join("\n") : "Executed without output. Use console.log(...) to display a result.",
    });
  } catch (error) {
    sendToParent({ type: "error", message: asMessage(error) });
  }
};
