import { Component, Input, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { isTutorialRunnerResponse } from "./tutorial-runner-protocol";
import { transpileTutorialCode } from "./tutorial-code-transpiler";
import type { TutorialCodeExample } from "./tutorial-content";

const RUN_TIMEOUT_MS = 5_000;

@Component({
  selector: "app-tutorial-code-cell",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./tutorial-code-cell.html",
})
export class TutorialCodeCellComponent implements OnInit, OnDestroy {
  @Input({ required: true }) example!: TutorialCodeExample;

  readonly source = signal("");
  readonly output = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly running = signal(false);

  private activeRun: { worker: Worker; timeout: ReturnType<typeof setTimeout> } | null = null;
  private runSequence = 0;
  private destroyed = false;

  ngOnInit(): void {
    this.source.set(this.example.code);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.runSequence += 1;
    this.stopActiveRun();
  }

  updateSource(source: string): void {
    this.source.set(source);
    this.output.set(null);
    this.errorMessage.set(null);
  }

  async run(): Promise<void> {
    this.stopActiveRun();
    const sequence = ++this.runSequence;
    this.output.set(null);
    this.errorMessage.set(null);
    this.running.set(true);

    try {
      const compiledSource = await transpileTutorialCode(this.source());
      if (this.destroyed || sequence !== this.runSequence) return;
      this.startWorker(compiledSource);
    } catch (error) {
      if (this.destroyed || sequence !== this.runSequence) return;
      this.errorMessage.set(
        error instanceof Error ? error.message : "Could not prepare the code.",
      );
      this.running.set(false);
    }
  }

  private startWorker(source: string): void {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./tutorial-runner.worker", import.meta.url), { type: "module" });
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : "The browser could not start the sandbox.",
      );
      this.running.set(false);
      return;
    }

    let finished = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (response: { readonly type: "complete"; readonly output: string }
      | { readonly type: "error"; readonly message: string }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.terminate();
      this.activeRun = null;
      this.running.set(false);
      if (response.type === "complete") {
        this.output.set(response.output);
      } else {
        this.errorMessage.set(response.message);
      }
    };

    timeout = setTimeout(
      () => finish({ type: "error", message: "Execution stopped after 5 seconds." }),
      RUN_TIMEOUT_MS,
    );
    this.activeRun = { worker, timeout };
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!isTutorialRunnerResponse(event.data)) {
        finish({ type: "error", message: "The sandbox returned an invalid response." });
        return;
      }
      finish(event.data);
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      event.preventDefault();
      finish({ type: "error", message: event.message || "An error occurred in the sandbox." });
    });

    try {
      worker.postMessage({ type: "run", source });
    } catch (error) {
      finish({
        type: "error",
        message: error instanceof Error ? error.message : "Could not send code to the sandbox.",
      });
    }
  }

  private stopActiveRun(): void {
    if (!this.activeRun) return;
    clearTimeout(this.activeRun.timeout);
    this.activeRun.worker.terminate();
    this.activeRun = null;
    this.running.set(false);
  }
}
