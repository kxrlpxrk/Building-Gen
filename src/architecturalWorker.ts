import {
  generateArchitecturalBuildings,
  type ArchitecturalConfig,
} from "./architecturalGenerator";
import type { BuildingWorkerReply } from "./buildingWorker";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ArchitecturalConfig>) => void) | null;
  postMessage: (reply: BuildingWorkerReply) => void;
};
scope.onmessage = (event) => {
  try {
    scope.postMessage({
      result: generateArchitecturalBuildings(event.data, (n) =>
        scope.postMessage({ progress: n }),
      ),
    });
  } catch (e) {
    scope.postMessage({ error: (e as Error).message });
  }
};
