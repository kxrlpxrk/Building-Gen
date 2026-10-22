import { validateProject, type Project } from "./model";
const DB_NAME = "building-generator-bg01";
let connection: Promise<IDBDatabase> | undefined;
function openDB(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("projects", { keyPath: "id" });
      request.onerror = () => {
        connection = undefined;
        reject(
          new Error(
            "Local database could not be opened. Check Safari storage permissions.",
          ),
        );
      };
      request.onblocked = () => {
        connection = undefined;
        reject(
          new Error(
            "Database update blocked. Close other Building Generator tabs and retry.",
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    });
  return connection.catch((error) => {
    connection = undefined;
    throw error;
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", mode),
      req = run(tx.objectStore("projects"));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () =>
      reject(
        new Error(
          tx.error?.message ||
            "Local storage operation failed. Your unsaved work is still in this session.",
        ),
      );
    tx.onerror = () => {
      /* onabort handles errors, including quota failures */
    };
  });
}
export const saveProject = async (p: Project) => {
  await transaction("readwrite", (store) => store.put(validateProject(p)));
};
export const deleteProject = async (id: string) => {
  await transaction("readwrite", (store) => store.delete(id));
};
export const loadProject = async (id: string): Promise<Project> => {
  const raw = await transaction("readonly", (store) => store.get(id));
  if (!raw)
    throw new Error(
      "This project no longer exists. Return to the library and refresh.",
    );
  return validateProject(raw);
};
export type LibraryResult = { projects: Project[]; invalidCount: number };
export async function listProjects(): Promise<LibraryResult> {
  const records = await transaction<unknown[]>("readonly", (store) =>
    store.getAll(),
  );
  const projects: Project[] = [];
  let invalidCount = 0;
  for (const record of records) {
    try {
      projects.push(validateProject(record));
    } catch {
      invalidCount++;
    }
  }
  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    invalidCount,
  };
}
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
