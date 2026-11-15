import { access, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const outputRoot = fileURLToPath(new URL("../dist/src/", import.meta.url));

async function sourceExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function cleanBuildOutput(directory, sourceDirectory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await cleanBuildOutput(path, join(sourceDirectory, entry.name));
    } else if (entry.isFile() && (entry.name.endsWith(".js.map") || entry.name.endsWith(".d.ts.map"))) {
      await unlink(path);
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      const sourceName = entry.name.replace(/(?:\.d\.ts|\.js)$/, ".ts");
      if (!await sourceExists(join(sourceDirectory, sourceName))) {
        await unlink(path);
        continue;
      }
      const contents = await readFile(path, "utf8");
      const cleaned = contents.replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, "\n");
      if (cleaned !== contents) await writeFile(path, cleaned);
    }
  }
}

await cleanBuildOutput(outputRoot, sourceRoot);
