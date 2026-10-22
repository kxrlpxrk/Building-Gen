import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { metres } from "./geometry";
import { serializeProject, type Project } from "./model";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        ⌂
      </span>
      <span>
        Building Generator<small>ARCHITECTURAL STUDIO</small>
      </span>
    </div>
  );
}
export function NumericField({
  label,
  value,
  unit = "m",
  onCommit,
  integer = false,
}: {
  label: string;
  value: number;
  unit?: string;
  integer?: boolean;
  onCommit: (n: number) => string | null;
}) {
  const format = (n: number) => (unit === "m" ? metres(n) : String(n));
  const [text, setText] = useState(format(value)),
    [error, setError] = useState("");
  useEffect(() => {
    setText(format(value));
    setError("");
  }, [value]);
  function apply() {
    const number = Number(text),
      converted = unit === "m" ? Math.round(number * 1000) : number;
    if (
      !text.trim() ||
      !Number.isFinite(number) ||
      (integer && !Number.isInteger(number)) ||
      (unit === "m" && Math.abs(number * 1000 - converted) > 0.000001)
    ) {
      setError(
        integer
          ? "Enter a whole number."
          : "Enter a number with up to 3 decimal places.",
      );
      return;
    }
    const issue = onCommit(converted);
    setError(issue || "");
    if (!issue) setText(format(converted));
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`input-unit ${error ? "invalid" : ""}`}>
        <input
          aria-label={label}
          aria-invalid={!!error}
          inputMode="decimal"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(format(value));
              setError("");
            }
          }}
        />
        <span>{unit}</span>
      </div>
      {error && (
        <small role="alert" className="field-error">
          {error}
        </small>
      )}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const first = node.querySelector<HTMLElement>("input, button");
    first?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const elements = [
          ...node.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, [tabindex="0"]',
          ),
        ];
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function downloadProject(project: Project) {
  const blob = new Blob([serializeProject(project)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "building"}.bg.json`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
