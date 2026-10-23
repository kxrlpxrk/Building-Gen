import { useRef, useState } from "react";
import type { Building } from "./model";
import {
  placeWindow,
  precisionWindow,
  type WindowAnchor,
  type WindowSession,
  type WindowPlacement,
} from "./windowPlacement";
export function useWindowPlacement(
  building: Building,
  onCommit: (b: Building) => void,
  onSelect: (sectionId: string, id: string) => void,
): WindowPlacement {
  const [state, setState] = useState<WindowSession | null>(null),
    ref = useRef(state),
    latest = useRef({ building, onCommit, onSelect });
  latest.current = { building, onCommit, onSelect };
  const restore = (s: WindowSession | null) => {
    ref.current = s;
    setState(s);
    const anchor = s?.draft ?? s?.source;
    if (anchor) latest.current.onSelect(anchor.sectionId, anchor.window.id);
  };
  function preview(draft: WindowAnchor) {
    const current = ref.current;
    if (!current) return;
    let issue = "";
    try {
      placeWindow(latest.current.building, draft, current.source);
    } catch (e) {
      issue = (e as Error).message;
    }
    restore({ ...current, draft, issue });
  }
  return {
    state,
    getState: () => ref.current,
    restore,
    preview,
    start: () =>
      restore({ mode: "place", source: null, draft: null, issue: "" }),
    move: (source) => {
      restore({ mode: "move", source, draft: null, issue: "" });
    },
    precision: (sectionId) => {
      try {
        if (!ref.current)
          restore({ mode: "place", source: null, draft: null, issue: "" });
        preview(precisionWindow(latest.current.building, sectionId));
      } catch (e) {
        const s = ref.current;
        if (s) restore({ ...s, issue: (e as Error).message });
      }
    },
    cancel: () => {
      const source = ref.current?.source;
      restore(null);
      if (source) latest.current.onSelect(source.sectionId, source.window.id);
    },
    commit: () => {
      const s = ref.current;
      if (!s?.draft) return "Tap an exposed wall to position the window first.";
      if (s.issue) return s.issue;
      try {
        const next = placeWindow(latest.current.building, s.draft, s.source);
        latest.current.onCommit(next);
        latest.current.onSelect(s.draft.sectionId, s.draft.window.id);
        restore(null);
        return null;
      } catch (e) {
        const issue = (e as Error).message;
        restore({ ...s, issue });
        return issue;
      }
    },
  };
}
