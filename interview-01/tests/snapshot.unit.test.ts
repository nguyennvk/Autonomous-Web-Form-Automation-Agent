import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendFailureToCsv,
  appendSnapshotToCsv,
  mergeSnapshots,
  type FormSnapshot,
} from "../src/_internal/snapshot";

const temporaryDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-tests-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("snapshot.ts", () => {
  it("merges fields captured from multiple accordion sections", () => {
    const snapshots: FormSnapshot[] = [
      {
        capturedAt: "2026-07-17T10:00:00.000Z",
        title: "Medical Form",
        url: "https://example.test/form",
        fields: [
          { name: "first_name", label: "First Name", type: "text", value: "Alex" },
          { name: "last_name", label: "Last Name", type: "text", value: "Carter" },
        ],
      },
      {
        capturedAt: "2026-07-17T10:01:00.000Z",
        title: "Medical Form",
        url: "https://example.test/form",
        fields: [
          { name: "insurance_plan", label: "Plan", type: "select", value: "premium" },
        ],
      },
    ];

    const merged = mergeSnapshots(snapshots);

    expect(merged.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "first_name", value: "Alex" }),
        expect.objectContaining({ name: "last_name", value: "Carter" }),
        expect.objectContaining({ name: "insurance_plan", value: "premium" }),
      ]),
    );
  });

  it("preserves a meaningful earlier value when a later snapshot is empty", () => {
    const merged = mergeSnapshots([
      {
        capturedAt: "2026-07-17T10:00:00.000Z",
        title: "Form",
        url: "https://example.test/form",
        fields: [{ name: "email", label: "Email", type: "email", value: "test@example.com" }],
      },
      {
        capturedAt: "2026-07-17T10:01:00.000Z",
        title: "Form",
        url: "https://example.test/form",
        fields: [{ name: "email", label: "Email", type: "email", value: "" }],
      },
    ]);

    expect(merged.fields[0].value).toBe("test@example.com");
  });

  it("appends successful runs to the same title-based CSV file", async () => {
    const outputDirectory = await makeTempDirectory();
    const snapshot: FormSnapshot = {
      capturedAt: "2026-07-17T10:00:00.000Z",
      title: "Medical Form",
      url: "https://example.test/form",
      fields: [{ name: "first_name", label: "First Name", type: "text", value: "Alex" }],
    };

    const filename = await appendSnapshotToCsv(snapshot, outputDirectory);
    await appendSnapshotToCsv(
      {
        ...snapshot,
        capturedAt: "2026-07-17T10:05:00.000Z",
        fields: [{ ...snapshot.fields[0], value: "Maya" }],
      },
      outputDirectory,
    );

    const csv = await readFile(filename, "utf8");
    expect(path.basename(filename)).toBe("Medical-Form.csv");
    expect(csv.match(/"run_id"/g)).toHaveLength(1);
    expect(csv).toContain('"Alex"');
    expect(csv).toContain('"Maya"');
  });

  it("writes agent-declared failures to fail.csv", async () => {
    const outputDirectory = await makeTempDirectory();
    const snapshot: FormSnapshot = {
      capturedAt: "2026-07-17T10:00:00.000Z",
      title: "Medical Form",
      url: "https://example.test/form",
      fields: [{ name: "first_name", label: "First Name", type: "text", value: "Alex" }],
    };

    const filename = await appendFailureToCsv(
      snapshot,
      {
        action: "FAIL",
        element_id: "",
        value: "",
        reason: "CAPTCHA blocked completion",
      },
      6,
      outputDirectory,
    );

    const csv = await readFile(filename, "utf8");
    expect(path.basename(filename)).toBe("fail.csv");
    expect(csv).toContain('"6"');
    expect(csv).toContain('"CAPTCHA blocked completion"');
    expect(csv).toContain('"Alex"');
  });
});
