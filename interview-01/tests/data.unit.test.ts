import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.chdir(originalWorkingDirectory);
  vi.resetModules();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("data.ts", () => {
  it("loads people sequentially and persists the next index", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "people-tests-"));
    temporaryDirectories.push(directory);
    process.chdir(directory);

    await writeFile(
      path.join(directory, "people.json"),
      JSON.stringify([
        { "First Name": "Alex", "Last Name": "Carter" },
        { "First Name": "Maya", "Last Name": "Lee" },
      ]),
      "utf8",
    );

    const { loadPerson } = await import("../src/_internal/data");

    await expect(loadPerson()).resolves.toMatchObject({ "First Name": "Alex" });

    // loadPerson currently starts saveProgress without awaiting it, so poll briefly.
    let progress: { nextIndex: number } | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        progress = JSON.parse(
          await readFile(path.join(directory, "run-data", "progress.json"), "utf8"),
        );
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    expect(progress?.nextIndex).toBe(1);
    await expect(loadPerson()).resolves.toMatchObject({ "First Name": "Maya" });
  });

  it("returns an empty object after all people are processed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "people-tests-"));
    temporaryDirectories.push(directory);
    process.chdir(directory);

    await writeFile(
      path.join(directory, "people.json"),
      JSON.stringify([{ "First Name": "Alex" }]),
      "utf8",
    );
    await writeFile(
      path.join(directory, "progress.json"),
      JSON.stringify({ nextIndex: 1, updatedAt: new Date().toISOString() }),
      "utf8",
    ).catch(() => undefined);

    // The production path is run-data/progress.json.
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(path.join(directory, "run-data"), { recursive: true }).then(() =>
        writeFile(
          path.join(directory, "run-data", "progress.json"),
          JSON.stringify({ nextIndex: 1, updatedAt: new Date().toISOString() }),
          "utf8",
        ),
      ),
    );

    const { loadPerson } = await import("../src/_internal/data");
    await expect(loadPerson()).resolves.toEqual({});
  });
});
