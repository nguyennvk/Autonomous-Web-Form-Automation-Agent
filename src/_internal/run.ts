import "dotenv-defaults/config";
import express from "express";
import cron from "node-cron";
import { main } from "../main";
import { loadPerson } from "./data";
import { ProvidedValuesSchema } from "./setup";
const app = express();
const PORT = 3000;
const HOST = "localhost";

// Automatically parse application/json request bodies.
app.use(
  express.json({
    limit: "1mb",
  })
);

app.post("/api/run", async (request, response) => {
  try {
    const providedValues = ProvidedValuesSchema.parse(request.body);

    const result = await main(providedValues);
    response.status(200).json({
      message: "Automation completed",
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://${HOST}:${PORT}`);
  scheduleAutomation();
});

let isRunning = false;

function scheduleAutomation(): void {
  cron.schedule("*/5 * * * *", async () => {
    if (isRunning) {
      console.log("Previous automation is still running. Skipping.");
      return;
    }

    isRunning = true;

    const person = await loadPerson();
    try {
      const response = await fetch(`http://${HOST}:${PORT}/api/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        // Empty when no provided values exist.
        body: JSON.stringify(person),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          `API failed with status ${response.status}: ${JSON.stringify(result)}`
        );
      }

      console.log("Scheduled run completed:", result);
    } catch (error) {
      console.error("Scheduled run failed:", error);
    } finally {
      isRunning = false;
    }
  });
}