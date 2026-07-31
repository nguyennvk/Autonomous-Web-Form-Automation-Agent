import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

// Prevent setup.ts from starting the real server and cron scheduler.
vi.mock("../src/_internal/run", () => ({}));

import { createSession } from "../src/session";
import {
  executeActionBatch,
  observePage,
  type AgentAction,
} from "../src/_internal/setup";
import {
  collectFormSnapshot,
  mergeSnapshots,
  type FormSnapshot,
} from "../src/_internal/snapshot";

const LIVE_URL = "https://magical-medical-form.netlify.app/";
const runLiveTests = process.env.RUN_LIVE_TESTS === "1";
const liveDescribe = runLiveTests ? describe : describe.skip;

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findElementId(
  observation: Awaited<ReturnType<typeof observePage>>,
  names: string[],
): string {
  const expectedNames = names.map(normalize);

  const element = observation.elements.find((candidate) => {
    const candidates = [
      candidate.label,
      candidate.name,
      candidate.placeholder,
      candidate.text,
      candidate.id,
    ].map(normalize);

    return expectedNames.some((expected) => candidates.includes(expected));
  });

  if (!element) {
    throw new Error(`Could not find live field matching: ${names.join(", ")}`);
  }

  return element.element_id;
}

async function closeSession(page: Page | undefined): Promise<void> {
  if (!page) return;

  const context = page.context();
  const browser = context.browser();

  await context.close();
  await browser?.close();
}

liveDescribe("live Magical medical form", () => {
  let page: Page | undefined;

  beforeAll(async () => {
    page = await createSession(LIVE_URL);
  }, 90_000);

  afterAll(async () => {
    await closeSession(page);
    page = undefined;
  });

  it(
    "fills the first live section, expands another section, and preserves snapshots",
    async () => {
      await expect(
        page!.getByText("Medical Information Form").first().isVisible(),
      ).resolves.toBe(true);
      await expect(
        page!.getByText("Personal Information").first().isVisible(),
      ).resolves.toBe(true);

      const initialObservation = await observePage(page!);

      expect(initialObservation.url).toBe(LIVE_URL);
      expect(initialObservation.visibleText).toContain("First Name");
      expect(initialObservation.visibleText).toContain("Last Name");
      expect(initialObservation.visibleText).toContain("Date of Birth");
      expect(initialObservation.visibleText).toContain("Medical ID");

      const actions: AgentAction[] = [
        {
          action: "FILL",
          element_id: findElementId(initialObservation, [
            "First Name",
            "first_name",
            "firstName",
          ]),
          value: "LiveTestFirst",
          reason: "Fill the live first-name field",
        },
        {
          action: "FILL",
          element_id: findElementId(initialObservation, [
            "Last Name",
            "last_name",
            "lastName",
          ]),
          value: "LiveTestLast",
          reason: "Fill the live last-name field",
        },
        {
          action: "FILL",
          element_id: findElementId(initialObservation, [
            "Date of Birth",
            "date_of_birth",
            "dateOfBirth",
            "dob",
          ]),
          value: "1990-01-01",
          reason: "Fill the live date-of-birth field",
        },
        {
          action: "FILL",
          element_id: findElementId(initialObservation, [
            "Medical ID",
            "medical_id",
            "medicalId",
          ]),
          value: "91927885",
          reason: "Fill the live medical-ID field",
        },
      ];

      await executeActionBatch(page!, actions);

      const filledObservation = await observePage(page!);
      expect(
        filledObservation.elements.some(
          (element) => element.value === "LiveTestFirst",
        ),
      ).toBe(true);
      expect(
        filledObservation.elements.some(
          (element) => element.value === "LiveTestLast",
        ),
      ).toBe(true);
      expect(
        filledObservation.elements.some(
          (element) => element.value === "1990-01-01",
        ),
      ).toBe(true);
      expect(
        filledObservation.elements.some(
          (element) => element.value === "91927885",
        ),
      ).toBe(true);

      const snapshots: FormSnapshot[] = [await collectFormSnapshot(page!)];

      const collapsedSection = page!
        .locator(
          'button[aria-expanded="false"], [role="button"][aria-expanded="false"]',
        )
        .first();

      await expect(collapsedSection.isVisible()).resolves.toBe(true);

      const sectionName = (await collapsedSection.innerText()).trim();
      const sectionElementId = await collapsedSection.getAttribute(
        "data-agent-id",
      );

      expect(sectionName).not.toBe("");
      expect(sectionElementId).toBeTruthy();

      await executeActionBatch(page!, [
        {
          action: "CLICK",
          element_id: sectionElementId!,
          value: "",
          reason: "Expand the next live form section",
        },
      ]);

      const expandedSection = page!
        .getByRole("button", { name: sectionName })
        .first();
      await expect(expandedSection.getAttribute("aria-expanded")).resolves.toBe(
        "true",
      );

      const expandedObservation = await observePage(page!);
      expect(expandedObservation.visibleText).not.toBe("");

      snapshots.push(await collectFormSnapshot(page!));
      const merged = mergeSnapshots(snapshots);

      expect(merged.url).toBe(LIVE_URL);
      expect(merged.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "LiveTestFirst" }),
          expect.objectContaining({ value: "LiveTestLast" }),
          expect.objectContaining({ value: "1990-01-01" }),
          expect.objectContaining({ value: "91927885" }),
        ]),
      );
    },
    90_000,
  );
});
