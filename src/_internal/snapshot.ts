import { access, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { AgentAction } from "./setup";
type SavedField = {
  name: string | null;
  label: string | null;
  type: string;
  value: string | string[] | boolean | null;
};


export type FormSnapshot = {
  capturedAt: string;
  url: string;
  title: string;
  fields: SavedField[];
};


function getFieldKey(field: SavedField): string {
  return [
    field.name,
    field.label,
    field.type,
  ]
    .filter(Boolean)
    .join("|")
    .trim()
    .toLowerCase();
}


function isEmptyValue(
  value: SavedField["value"]
): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}


export async function collectFormSnapshot(
  page: Page
): Promise<FormSnapshot> {
  return page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input, textarea, select")
    );

    const fields = controls.map(element => {
      const label =
        element.labels?.[0]?.textContent?.trim() ||
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        null;

      let value: string | string[] | boolean | null;

      if (
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" ||
          element.type === "radio")
      ) {
        value = element.checked;
      } else if (
        element instanceof HTMLInputElement &&
        element.type === "password"
      ) {
        // Avoid writing passwords to disk.
        value = "[REDACTED]";
      } else if (
        element instanceof HTMLInputElement &&
        element.type === "file"
      ) {
        value = Array.from(element.files ?? []).map(
          file => file.name
        );
      } else if (
        element instanceof HTMLSelectElement &&
        element.multiple
      ) {
        value = Array.from(element.selectedOptions).map(
          option => option.value
        );
      } else {
        value = element.value;
      }

      return {
        name:
          element.name ||
          element.id ||
          element.getAttribute("data-agent-id"),
        label,
        type:
          element instanceof HTMLTextAreaElement
            ? "textarea"
            : element instanceof HTMLSelectElement
              ? "select"
              : element.type || "text",
        value,
      };
    });

    return {
      capturedAt: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      fields,
    };
  });
}


export function mergeSnapshots(
  snapshots: FormSnapshot[]
): FormSnapshot {
  if (snapshots.length === 0) {
    throw new Error("No form snapshots were collected.");
  }

  const mergedFields = new Map<string, SavedField>();

  for (const snapshot of snapshots) {
    for (const field of snapshot.fields) {
      const key = getFieldKey(field);

      if (!key) {
        continue;
      }

      const existing = mergedFields.get(key);

      // Preserve an earlier meaningful value when a later
      // snapshot contains an empty version of the same field.
      if (isEmptyValue(field.value) && existing) {
        continue;
      }

      mergedFields.set(key, field);
    }
  }

  const firstSnapshot = snapshots[0];
  const lastSnapshot = snapshots.at(-1)!;

  return {
    capturedAt: new Date().toISOString(),
    title: firstSnapshot.title,
    url: lastSnapshot.url,
    fields: Array.from(mergedFields.values()),
  };
}


function escapeCsv(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value ?? "");

  return `"${text.replace(/"/g, '""')}"`;
}

async function fileExists(filename: string): Promise<boolean> {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}


function sanitizeFilename(title: string): string {
  const sanitized = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "untitled-form";
}

export async function appendSnapshotToCsv(
  snapshot: FormSnapshot,
  outputDirectory = "run-data"
): Promise<string> {
  await mkdir(outputDirectory, {
    recursive: true,
  });

  const filename = path.join(
    outputDirectory,
    `${sanitizeFilename(snapshot.title)}.csv`
  );

  const exists = await fileExists(filename);

  // All fields from the same snapshot share this run ID.
  const runId = snapshot.capturedAt;

  const header = [
    "run_id",
    "captured_at",
    "page_title",
    "url",
    "section",
    "field_name",
    "field_label",
    "field_type",
    "value",
  ]
    .map(escapeCsv)
    .join(",");

  const rows = snapshot.fields.map(field =>
    [
      runId,
      snapshot.capturedAt,
      snapshot.title,
      snapshot.url,
      field.name,
      field.label,
      field.type,
      field.value,
    ]
      .map(escapeCsv)
      .join(",")
  );

  const content = [
    ...(!exists ? [header] : []),
    ...rows,
  ].join("\n");

  await appendFile(
    filename,
    `${content}\n`,
    "utf8"
  );

  return filename;
}


export async function appendFailureToCsv(
  snapshot: FormSnapshot,
  failAction: AgentAction,
  step: number,
  outputDirectory = "run-data"
): Promise<string> {
  await mkdir(outputDirectory, {
    recursive: true,
  });

  const filename = path.join(
    outputDirectory,
    "fail.csv"
  );

  const exists = await fileExists(filename);
  const runId = crypto.randomUUID();

  const header = [
    "run_id",
    "captured_at",
    "page_title",
    "url",
    "failed_step",
    "failure_reason",
    "section",
    "field_name",
    "field_label",
    "field_type",
    "value",
  ]
    .map(escapeCsv)
    .join(",");

  // Still create one row when no fields were captured.
  const fields =
    snapshot.fields.length > 0
      ? snapshot.fields
      : [null];

  const rows = fields.map(field =>
    [
      runId,
      snapshot.capturedAt,
      snapshot.title,
      snapshot.url,
      step,
      failAction.reason,
      field?.name ?? "",
      field?.label ?? "",
      field?.type ?? "",
      field?.value ?? "",
    ]
      .map(escapeCsv)
      .join(",")
  );

  const content = [
    ...(!exists ? [header] : []),
    ...rows,
  ].join("\n");

  await appendFile(
    filename,
    `${content}\n`,
    "utf8"
  );

  return filename;
}