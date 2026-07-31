import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

// Prevent setup.ts from starting the real server and cron scheduler.
vi.mock("../src/_internal/run", () => ({}));

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  google: vi.fn(() => "mock-google-model"),
}));

vi.mock("ai", () => ({ generateObject: mocks.generateObject }));
vi.mock("@ai-sdk/google", () => ({ google: mocks.google }));

import { createSession } from "../src/session";
import {
  decideNextActions,
  executeActionBatch,
  observePage,
  type AgentAction,
  type HistoryEntry,
} from "../src/_internal/setup";
import {
  appendSnapshotToCsv,
  collectFormSnapshot,
  mergeSnapshots,
  type FormSnapshot,
} from "../src/_internal/snapshot";

async function closeSession(page: Page | undefined): Promise<void> {
  if (!page) return;

  const context = page.context();
  const browser = context.browser();

  await context.close();
  await browser?.close();
}

describe("three-section agent integration", () => {
  let page: Page | undefined;

  afterEach(async () => {
    await closeSession(page);
    page = undefined;
    mocks.generateObject.mockReset();
  });

  it("fills all sections, submits, and persists a merged snapshot", async () => {
    const fixture = await readFile(
      path.resolve(process.cwd(), "tests/fixtures/three-section-form.html"),
      "utf8",
    );

    // Launch through the production session function, then install the local
    // deterministic fixture into that page.
    page = await createSession("about:blank");
    await page.setContent(fixture, { waitUntil: "load" });

    mocks.generateObject.mockImplementation(
      async ({ prompt }: { prompt: string }) => {
        const state = JSON.parse(prompt);
        const observation = state.current_page;
        const elements = observation.elements as Array<{
          element_id: string;
          label: string | null;
          text: string | null;
          value: string | null;
        }>;

        const find = (label: string) =>
          elements.find(
            (element) => element.label === label || element.text === label,
          );

        let actions: AgentAction[];

        if (observation.visibleText.includes("Submission successful")) {
          actions = [
            {
              action: "DONE",
              element_id: "",
              value: "",
              reason: "Success is visible",
            },
          ];
        } else if (find("First Name")) {
          actions = [
            {
              action: "FILL",
              element_id: find("First Name")!.element_id,
              value: state.provided_values["first name"],
              reason: "Fill first name",
            },
            {
              action: "FILL",
              element_id: find("Last Name")!.element_id,
              value: state.provided_values["last name"],
              reason: "Fill last name",
            },
          ];
        } else if (find("Insurance Plan")) {
          actions = [
            {
              action: "SELECT",
              element_id: find("Insurance Plan")!.element_id,
              value: "Premium",
              reason: "Select a valid insurance plan",
            },
            {
              action: "FILL",
              element_id: find("Policy Number")!.element_id,
              value: "POL-1001",
              reason: "Generate a missing test value",
            },
          ];
        } else if (find("Notes")) {
          const notes = find("Notes")!;
          actions = notes.value
            ? [
                {
                  action: "CLICK",
                  element_id: find("Submit")!.element_id,
                  value: "",
                  reason: "Submit the completed form",
                },
              ]
            : [
                {
                  action: "FILL",
                  element_id: notes.element_id,
                  value: "Integration test entry",
                  reason: "Fill the remaining field",
                },
              ];
        } else {
          throw new Error("The scripted model received an unexpected page state");
        }

        return { object: { actions } };
      },
    );

    const history: HistoryEntry[] = [];
    const snapshots: FormSnapshot[] = [];
    const providedValues = { "first name": "Alex", "last name": "Carter" };
    let completed = false;

    for (let step = 1; step <= 12; step += 1) {
      const observation = await observePage(page);
      snapshots.push(await collectFormSnapshot(page));

      let actions = await decideNextActions({
        systemPrompt: "Use provided values and complete all sections.",
        goal: "Complete and submit the form",
        observation,
        history,
        currentDate: "2026-07-17T10:00:00.000Z",
        providedValues,
      });

      // Navigation remains deterministic while the model controls field actions.
      if (
        observation.visibleText.includes("Patient") &&
        observation.elements.some((element) => element.value === "Alex")
      ) {
        const target = observation.elements.find(
          (element) => element.label === "Section 2",
        );
        expect(target).toBeDefined();
        actions = [
          {
            action: "CLICK",
            element_id: target!.element_id,
            value: "",
            reason: "Open Section 2",
          },
        ];
      } else if (
        observation.visibleText.includes("Insurance") &&
        observation.elements.some((element) => element.value === "POL-1001")
      ) {
        const target = observation.elements.find(
          (element) => element.label === "Section 3",
        );
        expect(target).toBeDefined();
        actions = [
          {
            action: "CLICK",
            element_id: target!.element_id,
            value: "",
            reason: "Open Section 3",
          },
        ];
      }

      if (actions.some((action) => action.action === "DONE")) {
        completed = true;
        break;
      }

      await executeActionBatch(page, actions);
      snapshots.push(await collectFormSnapshot(page));
      history.push({ step, action: actions, url: page.url() });
    }

    expect(completed).toBe(true);
    await expect(page.getByText("Submission successful").count()).resolves.toBe(1);

    const merged = mergeSnapshots(snapshots);
    expect(merged.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "first_name", value: "Alex" }),
        expect.objectContaining({ name: "last_name", value: "Carter" }),
        expect.objectContaining({ name: "insurance_plan", value: "Premium" }),
        expect.objectContaining({ name: "policy_number", value: "POL-1001" }),
        expect.objectContaining({ name: "notes", value: "Integration test entry" }),
      ]),
    );

    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), "agent-integration-"),
    );

    try {
      const filename = await appendSnapshotToCsv(merged, outputDirectory);
      const csv = await readFile(filename, "utf8");

      expect(csv).toContain('"Alex"');
      expect(csv).toContain('"POL-1001"');
      expect(csv).toContain('"Integration test entry"');
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
