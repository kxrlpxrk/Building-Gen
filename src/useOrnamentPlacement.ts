import { useEffect, useRef, useState } from "react";
import type { Building } from "./model";
import { suggestedOrnament } from "./ornamentation";
import {
  ornamentPlacementContext,
  positionOrnament,
  previewOrnament,
  placeOrnament,
  type OrnamentPlacement,
  type OrnamentSession,
  type OrnamentAnchor,
} from "./ornamentPlacement";
export function useOrnamentPlacement(
  building: Building,
  step: number | null,
  onCommit: (b: Building) => void,
  onSelect: (sectionId: string, id: string) => void,
): OrnamentPlacement {
  const [state, setState] = useState<OrnamentSession | null>(null),
    ref = useRef(state),
    latest = useRef({ building, step, onCommit, onSelect }),
    base = useRef(building),
    context = useRef<ReturnType<typeof ornamentPlacementContext> | null>(null);
  latest.current = { building, step, onCommit, onSelect };
  const restore = (s: OrnamentSession | null) => {
    const previous = ref.current?.draft ?? ref.current?.source;
    ref.current = s;
    setState(s);
    const a = s?.draft ?? s?.source;
    if (
      a &&
      (a.sectionId !== previous?.sectionId ||
        a.ornament.id !== previous?.ornament.id)
    )
      latest.current.onSelect(a.sectionId, a.ornament.id);
  };
  function preview(draft: OrnamentAnchor) {
    const s = ref.current;
    if (!s) return;
    let issue = "";
    try {
      if (base.current !== latest.current.building)
        throw new Error("Building changed. Cancel and start placement again.");
      previewOrnament(base.current, draft, s.source, context.current!);
    } catch (e) {
      issue = (e as Error).message;
    }
    restore({ ...s, draft, template: draft.ornament, issue });
  }
  const cancel = () => {
    const source = ref.current?.source;
    restore(null);
    context.current = null;
    if (source) latest.current.onSelect(source.sectionId, source.ornament.id);
  };
  useEffect(() => {
    cancel();
  }, [building]);
  return {
    state,
    getState: () => ref.current,
    restore,
    preview,
    cancel,
    start: (type) => {
      base.current = latest.current.building;
      context.current = ornamentPlacementContext(base.current);
      const s = base.current.sections[0],
        template = suggestedOrnament(base.current, s, type);
      restore({
        mode: "place",
        source: null,
        draft: null,
        template,
        issue: "",
        hit: null,
      });
      latest.current.onSelect(s.id, template.id);
    },
    move: (source) => {
      base.current = latest.current.building;
      context.current = ornamentPlacementContext(base.current);
      restore({
        mode: "move",
        source,
        draft: null,
        template: source.ornament,
        issue: "",
        hit: null,
      });
    },
    position: (hit, grab, visible) => {
      const s = ref.current;
      if (!s) return;
      if (!hit) {
        restore({
          ...s,
          issue:
            "Tap a visible compatible wall, gable or ridge. Hidden surfaces are not placement targets.",
          hit: null,
        });
        return;
      }
      try {
        const draft = positionOrnament(
          base.current,
          hit,
          s.draft?.ornament ?? s.template,
          latest.current.step,
          context.current!,
          grab,
        );
        if (visible && !visible(draft))
          throw new Error(
            "The chosen ornament anchor is occluded by the building. Orbit to expose it or choose another visible anchor.",
          );
        preview(draft);
        if (ref.current) restore({ ...ref.current, hit });
      } catch (e) {
        restore({ ...s, draft: null, hit, issue: (e as Error).message });
      }
    },
    commit: () => {
      const s = ref.current;
      if (!s?.draft) return "Choose a supported anchor first.";
      if (s.issue) return s.issue;
      try {
        if (base.current !== latest.current.building)
          throw new Error(
            "Building changed. Cancel and start placement again.",
          );
        const next = placeOrnament(base.current, s.draft, s.source);
        latest.current.onCommit(next);
        latest.current.onSelect(s.draft.sectionId, s.draft.ornament.id);
        restore(null);
        context.current = null;
        return null;
      } catch (e) {
        const issue = (e as Error).message;
        restore({ ...s, issue });
        return issue;
      }
    },
  };
}
