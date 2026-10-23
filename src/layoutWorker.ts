import {
  generateLayouts,
  type LayoutConfig,
  type LayoutResult,
} from "./layoutGenerator";
import type { Project } from "./model";
export type LayoutWorkerReply =
  { result: LayoutResult } | { error: string } | { progress: number };
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{ project: Project; config: LayoutConfig }>,
      ) => void)
    | null;
  postMessage: (reply: LayoutWorkerReply) => void;
};
scope.onmessage = (event) => {
  try {
    scope.postMessage({
      result: generateLayouts(event.data.project, event.data.config, (n) =>
        scope.postMessage({ progress: n }),
      ),
    });
  } catch (e) {
    scope.postMessage({
      error:
        e instanceof Error
          ? e.message
          : "Layout generation failed. The original plan is unchanged.",
    });
  }
};
