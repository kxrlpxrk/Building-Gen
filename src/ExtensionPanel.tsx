import { useRef } from "react";
import type { Building, Section } from "./model";
import {
  attachmentBase,
  EXTENSION_TEMPLATES,
  type AttachmentConfig,
} from "./attachments";
import { combinedGeometry, SECTION_TYPES } from "./assembly";
import { edgeLength, SHAPES, type Shape } from "./polygon";
import { metres } from "./geometry";
import { NumericField } from "./components";
type Props = {
  building: Building;
  config: AttachmentConfig;
  source?: Section;
  error: string | null;
  onChange: (c: AttachmentConfig) => void;
  onAccept: () => void;
  onCancel: () => void;
};
export default function ExtensionPanel({
  building,
  config,
  source,
  error,
  onChange,
  onAccept,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null),
    outline = combinedGeometry(attachmentBase(building)).vertices;
  return (
    <div className="inspector-section extension-panel" ref={ref}>
      <h2>{source ? "Attach section copy" : "Attach Extension"}</h2>
      <p className="field-hint">
        Translucent preview only. Choose an external edge, adjust the join, then
        accept. Joins are open-plan; doorways are not generated.
      </p>
      {!source && (
        <label className="field">
          <span>Extension template</span>
          <select
            aria-label="Extension template"
            defaultValue={EXTENSION_TEMPLATES[0].name}
            onChange={(e) => {
              const t = EXTENSION_TEMPLATES.find(
                (t) => t.name === e.target.value,
              )!;
              onChange({
                ...config,
                name: t.name,
                type: t.type,
                length: t.length,
                width: t.width,
                shape: t.shape,
              });
            }}
          >
            {EXTENSION_TEMPLATES.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Extension name</span>
        <input
          aria-label="Extension name"
          value={config.name}
          maxLength={100}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Section type</span>
        <select
          aria-label="Extension section type"
          value={config.type}
          disabled={!!source}
          onChange={(e) =>
            onChange({
              ...config,
              type: e.target.value as AttachmentConfig["type"],
            })
          }
        >
          {SECTION_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      {!source && (
        <>
          <label className="field">
            <span>Extension shape</span>
            <select
              aria-label="Extension shape"
              value={config.shape}
              onChange={(e) =>
                onChange({ ...config, shape: e.target.value as Shape })
              }
            >
              {SHAPES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <NumericField
              label="Extension length"
              value={config.length}
              onCommit={(length) => {
                onChange({ ...config, length });
                return null;
              }}
            />
            <NumericField
              label="Extension depth"
              value={config.width}
              onCommit={(width) => {
                onChange({ ...config, width });
                return null;
              }}
            />
          </div>
        </>
      )}
      <label className="field">
        <span>External attachment edge</span>
        <select
          aria-label="External attachment edge"
          value={config.edge}
          onChange={(e) =>
            onChange({ ...config, edge: Number(e.target.value) })
          }
        >
          {outline.map((p, i) => (
            <option key={i} value={i}>
              Edge {i + 1} · {metres(edgeLength(outline, i))} m · {metres(p.x)},{" "}
              {metres(p.y)}
            </option>
          ))}
        </select>
      </label>
      <NumericField
        label="Along-edge offset"
        value={config.offset}
        onCommit={(offset) => {
          onChange({ ...config, offset });
          return null;
        }}
      />
      <p
        className={`placement-status ${error ? "invalid-preview" : "valid-preview"}`}
        role={error ? "alert" : "status"}
      >
        {error || "Valid attachment · connected open-plan join"}
      </p>
      <div className="section-actions">
        <button onClick={onCancel}>Cancel attachment</button>
        <button
          className="primary"
          disabled={!!error}
          onClick={() => {
            const invalid = ref.current?.querySelector<HTMLInputElement>(
              '[aria-invalid="true"]',
            );
            if (invalid) {
              invalid.focus();
              return;
            }
            onAccept();
          }}
        >
          Accept extension
        </button>
      </div>
    </div>
  );
}
