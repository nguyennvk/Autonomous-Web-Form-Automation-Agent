import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

// setup.ts imports run.ts at runtime even though it only needs a type.
// Mock it so importing setup.ts does not start Express or the cron scheduler.
vi.mock("../src/_internal/run", () => ({}));

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  google: vi.fn(() => "mock-google-model"),
}));

vi.mock("ai", () => ({
  generateObject: mocks.generateObject,
}));

vi.mock("@ai-sdk/google", () => ({
  google: mocks.google,
}));

import { createSession } from "../src/session";
import {
  decideNextActions,
  executeActionBatch,
  observePage,
  type AgentAction,
} from "../src/_internal/setup";

async function closeSession(page: Page | undefined): Promise<void> {
  if (!page) return;

  const context = page.context();
  const browser = context.browser();

  await context.close();
  await browser?.close();
}

describe("setup.ts", () => {
  let page: Page | undefined;

  beforeEach(async () => {
    page = await createSession("about:blank");
    mocks.generateObject.mockReset();
    mocks.google.mockClear();
  });

  afterEach(async () => {
    await closeSession(page);
    page = undefined;
  });

  it("assigns synthetic element IDs to controls without native HTML IDs", async () => {
    await page!.setContent(`
      <button aria-label="Expand details">Expand</button>
      <input name="first_name" placeholder="First name" />
    `);

    const observation = await observePage(page!);

    expect(observation.elements).toHaveLength(2);
    expect(observation.elements[0]).toMatchObject({
      id: null,
      element_id: "agent-0",
      label: "Expand details",
    });

    await expect(
      page!.locator('[data-agent-id="agent-0"]').count(),
    ).resolves.toBe(1);
  });

  it("executes FILL, SELECT, and CLICK actions against observed IDs", async () => {
    await page!.setContent(`
      <input aria-label="First name" />
      <select aria-label="Plan">
        <option value="">Choose</option>
        <option value="premium">Premium</option>
      </select>
      <button aria-label="Continue" onclick="document.body.dataset.clicked='yes'">
        Continue
      </button>
    `);

    const observation = await observePage(page!);
    const byLabel = new Map(
      observation.elements.map((element) => [element.label, element.element_id]),
    );

    await executeActionBatch(page!, [
      {
        action: "FILL",
        element_id: byLabel.get("First name")!,
        value: "Alex",
        reason: "Fill the first name",
      },
      {
        action: "SELECT",
        element_id: byLabel.get("Plan")!,
        value: "Premium",
        reason: "Choose the plan",
      },
    ]);

    await executeActionBatch(page!, [
      {
        action: "CLICK",
        element_id: byLabel.get("Continue")!,
        value: "",
        reason: "Continue",
      },
    ]);

    await expect(
      page!.locator('input[aria-label="First name"]').inputValue(),
    ).resolves.toBe("Alex");
    await expect(
      page!.locator('select[aria-label="Plan"]').inputValue(),
    ).resolves.toBe("premium");
    await expect(
      page!.locator("body").getAttribute("data-clicked"),
    ).resolves.toBe("yes");
  });

  it("sends goal, page state, history, date, and provided values to the model", async () => {
    const expectedActions: AgentAction[] = [
      {
        action: "FILL",
        element_id: "agent-0",
        value: "John",
        reason: "Use the provided first name",
      },
    ];

    mocks.generateObject.mockResolvedValue({
      object: { actions: expectedActions },
    });

    const observation = {
      url: "https://example.test/form",
      title: "Test form",
      visibleText: "First_name",
      elements: [
        {
          index: 0,
          id: null,
          element_id: "agent-0",
          tag: "input",
          role: null,
          type: "text",
          label: null,
          name: "First_name",
          placeholder: null,
          text: null,
          value: "",
        },
      ],
    };

    const actions = await decideNextActions({
      systemPrompt: "SYSTEM RULES",
      goal: "Complete the form",
      observation,
      history: [],
      currentDate: "2026-07-17T10:00:00.000Z",
      providedValues: { "first name": "John" },
    });

    expect(actions).toEqual(expectedActions);
    expect(mocks.google).toHaveBeenCalledWith("gemini-3.5-flash");

    const call = mocks.generateObject.mock.calls[0][0];
    expect(call.system).toBe("SYSTEM RULES");
    expect(call.temperature).toBe(0.1);

    const parsedPrompt = JSON.parse(call.prompt);
    expect(parsedPrompt).toMatchObject({
      goal_and_constraints: "Complete the form",
      current_date: "2026-07-17T10:00:00.000Z",
      provided_values: { "first name": "John" },
      current_page: observation,
      recent_action_history: [],
    });
  });
});
