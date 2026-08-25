import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { Locator, Page } from "playwright";
import { z } from "zod";

type InteractiveElement = {
  index: number;
  id: string | null;
  element_id: string;
  tag: string | null;
  role: string | null;
  type: string | null;
  label: string | null;
  name: string | null;
  placeholder: string | null;
  text: string | null;
  value: string | null;
};

type PageObservation = {
  url: string;
  title: string;
  visibleText: string;
  elements: InteractiveElement[];
};

export const ProvidedValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])
);

export type ProvidedValuesSchemaType = z.infer<typeof ProvidedValuesSchema>;

// Observing the current visible page
export async function observePage(page: Page): Promise<PageObservation> {
  return page.evaluate(() => {
    const selector = [
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='combobox']",
      "[role='option']",
      "[role='listbox']",
      "[aria-autocomplete]",
      "[aria-expanded]",
      "[contenteditable='true']",
  ].join(",");

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(selector)
    ).map((element, index) => {
      let value: string | null = null;

      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        value = element.value;
      }

      element.setAttribute("data-agent-id", `agent-${index}`);

      return {
        index,
        element_id: `agent-${index}`,
        id: element.id || null,
        tag: element.tagName.toLowerCase() || null,
        role: element.getAttribute("role") || null,
        type: element.getAttribute("type") || null,
        label: element.getAttribute("aria-label") || null,
        name: element.getAttribute("name") || null,
        placeholder: element.getAttribute("placeholder") || null,
        text: element.innerText?.trim() || null,
        value,
      };
    });
    return {
      title: document.title,
      url: document.URL,
      visibleText: document.body.innerText,
      elements,
    };
  });
}

const AgentActionSchema = z
  .object({
    action: z.enum([
      "CLICK",
      "FILL",
      "SELECT",
      "NAVIGATE",
      "WAIT",
      "DONE",
      "FAIL",
    ]),
    element_id: z.string(),
    value: z.string(),
    reason: z.string(),
  })
  .strict();

export type AgentAction = z.infer<typeof AgentActionSchema>;

const AgentResponseSchema = z
  .object({
    actions: z.array(AgentActionSchema).min(1).max(10),
  })
  .strict();

export type HistoryEntry = {
  step: number;
  action: AgentAction[];
  // result: string;
  url: string;
};

// Using the observed page, deciding the next action given the goal
export async function decideNextActions(options: {
  systemPrompt: string;
  goal: string;
  observation: PageObservation;
  history: HistoryEntry[];
  currentDate: string;
  providedValues: ProvidedValuesSchemaType;
}): Promise<AgentAction[]> {
  const userPrompt = JSON.stringify(
    {
      goal_and_constraints: options.goal,
      current_page: options.observation,
      recent_action_history: options.history.slice(-8),
      current_date: options.currentDate,
      provided_values: options.providedValues,
    },
    null,
    2
  );

  const { object } = await generateObject({
    model: google("gemini-3.5-flash"),
    system: options.systemPrompt,
    prompt: userPrompt,
    schema: AgentResponseSchema,
    temperature: 0.1,
  });

  return object.actions;
}

// Execute the action
function getTarget(page: Page, elementId: string): Locator {
  if (!elementId) {
    throw new Error("This action requires element_id.");
  }
  return page.locator(`[data-agent-id="${elementId}"]`);
}

async function isSubmitTarget(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const text = (
      element.textContent ||
      element.getAttribute("value") ||
      element.getAttribute("aria-label") ||
      ""
    )
      .trim()
      .toLowerCase();

    const type = element.getAttribute("type")?.toLowerCase();

    const isNativeSubmit =
      type === "submit" ||
      (element instanceof HTMLButtonElement && element.type === "submit");

    const hasSubmitText =
      /^(submit|finish|complete|send|confirm|save and submit)$/i.test(text);

    return isNativeSubmit || hasSubmitText;
  });
}

async function executeAction(page: Page, action: AgentAction): Promise<string> {
  switch (action.action) {
    case "FILL": {
      const target = getTarget(page, action.element_id);
      await target.fill(action.value, { timeout: 10_000 });
      return `Filled ${action.element_id}`;
    }
    case "SELECT": {
      const target = getTarget(page, action.element_id);
      try {
        await target.selectOption({ label: action.value });
      } catch {
        await target.selectOption(action.value);
      }
      return `Selected "${action.value}" in ${action.element_id}`;
    }
    case "CLICK": {
      const target = getTarget(page, action.element_id);

      await target.click({ timeout: 10_000 });
      return `Clicked ${action.element_id}`;
    }
    case "NAVIGATE": {
      switch (action.value) {
        case "up":
          await page.mouse.wheel(0, -600);
          break;
        case "down":
          await page.mouse.wheel(0, 600);
          break;
        case "top":
          await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: "instant" });
          });
          break;
        case "bottom":
          await page.evaluate(() => {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: "instant",
            });
          });
          break;
        default:
          throw new Error(`Invalid NAVIGATE value: ${action.value}`);
      }
      return `Scrolled ${action.value}`;
    }
    case "WAIT": {
      const requested = Number(action.value);
      const duration = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 100), 5_000)
        : 1_000;
      await page.waitForTimeout(duration);
      return `Waited ${duration}ms`;
    }
    case "DONE":
      return "Goal completed";
    case "FAIL":
      return `Agent failed: ${action.reason}`;
  }
}

export async function executeActionBatch(page: Page, actions: AgentAction[]) {
  const results: string[] = [];
  for (const action of actions) {
    results.push(await executeAction(page, action));
  }
  /* * Allow dropdowns, accordions, validation messages, * and navigation changes to update before re-observing. */
  await page.waitForTimeout(300);
  return results;
}
