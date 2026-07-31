import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const PEOPLE_FILE = path.resolve(
  process.cwd(),
  "people.json"
);

type ProvidedValue = string | number | boolean | null;

type Person = Record<string, ProvidedValue>;

type Progress = {
  nextIndex: number;
  updatedAt: string;
};

const PROGRESS_FILE = path.resolve(
  process.cwd(),
  "run-data",
  "progress.json"
);

async function readJson<T>(
  filename: string
): Promise<T> {
  const content = await readFile(filename, "utf8");
  return JSON.parse(content) as T;
}

export async function loadPerson(): Promise<Person> {
  const index = (await loadProgress()).nextIndex;
  const content = await readFile(PEOPLE_FILE, "utf8");
  const people = JSON.parse(content) as Person[];

  if (!Number.isInteger(index) || index < 0 || index >= people.length) {
    return {};
  }

  saveProgress(index+1);
  return people[index];
}



async function loadProgress(): Promise<Progress> {
  try {
    return await readJson<Progress>(PROGRESS_FILE);
  } catch (error) {
    const fileError =
      error as NodeJS.ErrnoException;

    if (fileError.code === "ENOENT") {
      return {
        nextIndex: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    throw error;
  }
}


async function saveProgress(
  nextIndex: number
): Promise<void> {
  await mkdir(path.dirname(PROGRESS_FILE), {
    recursive: true,
  });

  const progress: Progress = {
    nextIndex,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(
    PROGRESS_FILE,
    JSON.stringify(progress, null, 2),
    "utf8"
  );
}
