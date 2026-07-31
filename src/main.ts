import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  decideNextActions,
  executeActionBatch,
  HistoryEntry,
  observePage,
  ProvidedValuesSchemaType,
} from "../src/_internal/setup";
import {
  appendFailureToCsv,
  appendSnapshotToCsv,
  collectFormSnapshot,
  FormSnapshot,
  mergeSnapshots,
} from "./_internal/snapshot";
import { createSession } from "./session";

export async function main(providedValues: ProvidedValuesSchemaType) {
  // This will automatically create a chromium instance, connect, and navigate to the given url.
  // You are given a playwright page back.
  const url = process.env.URL || "https://magical-medical-form.netlify.app/";
  const page = await createSession(url);
  const context = page.context();
  const browser = context.browser();

  const systemPrompt = await readFile(
    path.resolve(process.cwd(), "AGENTS.md"),
    "utf8"
  );
  const goal =
    "Fill out the full form with reasonable information. Make sure to expand necessary part and fill in all the information.";
  const history: HistoryEntry[] = [];
  const snapshots: FormSnapshot[] = [];
  // Agentic loop
  const maxSteps = 15;
  try {
    for (let step = 1; step < maxSteps; step++) {
      const observedPage = await observePage(page);
      console.log(observedPage);

      const snapshot = await collectFormSnapshot(page);
      snapshots.push(snapshot);

      const actions = await decideNextActions({
        systemPrompt: systemPrompt,
        goal: goal,
        observation: observedPage,
        history: history,
        currentDate: new Date().toISOString(),
        providedValues: providedValues,
      });
      console.log(actions);
      const doneAction = actions.find((action) => action.action === "DONE");

      if (doneAction) {
        const mergedSnapshot = mergeSnapshots(snapshots);

        await appendSnapshotToCsv(mergedSnapshot);

        console.log("Task completed:", doneAction.reason);
        return;
      }

      const failAction = actions.find((action) => action.action === "FAIL");

      if (failAction) {
        const mergedSnapshot = mergeSnapshots(snapshots);

        const filename = await appendFailureToCsv(
          mergedSnapshot,
          failAction,
          step
        );

        console.error(`Failed run recorded in ${filename}`);

        throw new Error(failAction.reason);
      }

      await executeActionBatch(page, actions);
      history.push({
        step: step,
        action: actions,
        // result: "",
        url: observedPage.url,
      });
    }
  } finally {
    await context.close();
    await browser?.close();
  }
}
