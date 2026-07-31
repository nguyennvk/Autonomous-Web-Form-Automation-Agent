# Autonomous Medical Form Agent

A TypeScript automation agent that uses **Playwright** and **Google Gemini** to inspect, complete, and submit the Magical medical form:
Author: Nguyen Vo Khoi Nguyen

```text
https://magical-medical-form.netlify.app/
```

## Key Features

- Works with different form URLs by passing the target URL when starting a browser session.
- Observes visible interactive elements and assigns temporary data-agent-id attributes for reliable targeting.
- Uses Gemini to decide the next browser actions based on the current page state.
- Accepts predefined user information through prompt variables, allowing the agent to fill forms with supplied values instead of generating them.
- Validates all model-generated actions with Zod before execution.
- Supports FILL, SELECT, CLICK, NAVIGATE, WAIT, DONE, and FAIL.
- Handles multi-section, accordion-based, and dynamically rendered forms.
- Saves form snapshots across sections and merges them before writing the final result.
- Records successful jobs in a results CSV and failed jobs in a separate failure CSV.
- Exposes an API for manually starting automation jobs with custom input values.
- Reads multiple people from people.json and processes one person every five minutes.
- Persists the next person index in run-data/progress.json, allowing processing to continue after a restart.
- Prevents overlapping scheduled jobs.
- Closes Chromium after every completed or failed job.
## Workflow

```text
Input values
   ↓
Launch Chromium
   ↓
Observe page
   ↓
Gemini selects actions
   ↓
Validate with Zod
   ↓
Execute with Playwright
   ↓
Save snapshot and repeat
   ↓
DONE → success CSV
FAIL → failure CSV
```

## Setup

```bash
rm -rf node_modules
rm -rf package-lock.json
npm install
npx playwright install chromium
```

Create `.env`:

```env
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key
```

## Input Data

### Manual API run

Send a JSON object containing known form values:

```json
{
  "First Name": "John",
  "Last Name": "Doe",
  "Date of Birth": "1990-01-01",
  "Medical ID": "91927885"
}
```

Start the server:

```bash
npm run dev
```
By default, the development server is available at:

```text
http://localhost:3000
```

The default target form is:

```text
https://magical-medical-form.netlify.app/
```

Call the API:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "First Name": "John",
    "Last Name": "Doe",
    "Date of Birth": "1990-01-01",
    "Medical ID": "91927885"
  }' \
  http://localhost:3000/api/run
```

### Scheduled runs

Store records in `people.json`:

```json
[
  {
    "First Name": "Alex",
    "Last Name": "Carter",
    "Date of Birth": "1992-04-15",
    "Medical ID": "12004561"
  },
  {
    "First Name": "Maya",
    "Last Name": "Lee",
    "Date of Birth": "1996-08-21",
    "Medical ID": "12004562"
  }
]
```

The scheduler runs one person every five minutes:

```text
10:00 → person 1
10:05 → person 2
10:10 → person 3
```

It runs only while the Node process is active.

## Tech Stack

- TypeScript and Node.js
- Playwright
- Google Gemini via Vercel AI SDK
- Express
- Zod
- node-cron
- Vitest

## Persistence and Output

Progress is saved in:

```text
run-data/progress.json
```

This allows the scheduler to continue from the next person after a restart.

Successful runs are appended to a form-specific CSV. Failed runs are written to:

```text
run-data/fail.csv
```

## Testing

Run deterministic unit and integration tests:

```bash
npx vitest run
```

Run the live website test:

```bash
RUN_LIVE_TESTS=1 npx vitest run tests/live-url.integration.test.ts
```

Because `createSession()` uses `headless: false`, Linux environments without a display may require:

```bash
xvfb-run -a npx vitest run
```

## Project Structure

```text
src/
|───_internal/
|   ├── data.ts
|   ├── run.ts
|   ├── setup.ts
|   ├── snapshots.ts
├── main.ts
├── session.ts

tests/
├── setup.unit.test.ts
├── snapshot.unit.test.ts
├── data.unit.test.ts
├── agent-loop.integration.test.ts
└── live-url.integration.test.ts
```

## Notes

- The agent may generate fictional values for missing fields according to `AGENTS.md`.
- The public form or Gemini output may change, so deterministic local tests should remain the primary regression suite.
- For production use, consider a persistent job queue, centralized locking, retries, and failure screenshots or traces.
