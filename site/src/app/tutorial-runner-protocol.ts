export interface TutorialRunnerRequest {
  readonly type: "run";
  readonly source: string;
}

export type TutorialRunnerResponse =
  | { readonly type: "complete"; readonly output: string }
  | { readonly type: "error"; readonly message: string };

export function isTutorialRunnerResponse(value: unknown): value is TutorialRunnerResponse {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const response = value as { type?: unknown; output?: unknown; message?: unknown };
  return (response.type === "complete" && typeof response.output === "string")
    || (response.type === "error" && typeof response.message === "string");
}
