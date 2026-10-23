import {
  generateBuildings,
  type BuildingConfig,
  type BuildingResult,
} from "./buildingGenerator";
export type BuildingWorkerReply =
  { result: BuildingResult } | { error: string } | { progress: number };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BuildingConfig>) => void) | null;
  postMessage: (reply: BuildingWorkerReply) => void;
};
scope.onmessage = (event) => {
  try {
    scope.postMessage({
      result: generateBuildings(event.data, (n) =>
        scope.postMessage({ progress: n }),
      ),
    });
  } catch (e) {
    scope.postMessage({
      error:
        e instanceof Error
          ? e.message
          : "Building generation failed; the original project is unchanged.",
    });
  }
};
