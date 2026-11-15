import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("build output cleanup", () => {
  it("removes stale generated files while keeping current output and unrelated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ts-cas-build-test-"));
    try {
      await mkdir(join(root, "scripts"));
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "dist", "src", "old"), { recursive: true });
      await copyFile(
        fileURLToPath(new URL("../scripts/remove-build-source-maps.mjs", import.meta.url)),
        join(root, "scripts", "remove-build-source-maps.mjs"),
      );
      await writeFile(join(root, "src", "current.ts"), "export const value = 1;\n");
      await writeFile(join(root, "dist", "src", "current.js"), "export const value = 1;\n//# sourceMappingURL=current.js.map\n");
      await writeFile(join(root, "dist", "src", "current.d.ts"), "export declare const value = 1;\n");
      await writeFile(join(root, "dist", "src", "current.js.map"), "{}");
      await writeFile(join(root, "dist", "src", "old", "removed.js"), "old");
      await writeFile(join(root, "dist", "src", "old", "removed.d.ts"), "old");
      await writeFile(join(root, "dist", "src", "old", "notes.txt"), "keep");

      execFileSync(process.execPath, [join(root, "scripts", "remove-build-source-maps.mjs")]);

      expect(await readFile(join(root, "dist", "src", "current.js"), "utf8")).toBe("export const value = 1;\n");
      expect(await readFile(join(root, "dist", "src", "current.d.ts"), "utf8")).toContain("value");
      expect(await readFile(join(root, "dist", "src", "old", "notes.txt"), "utf8")).toBe("keep");
      await expect(readFile(join(root, "dist", "src", "current.js.map"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "dist", "src", "old", "removed.js"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "dist", "src", "old", "removed.d.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
