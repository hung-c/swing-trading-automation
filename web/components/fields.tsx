export function Num({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step="any"
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function StepArrow({ dir }: { dir: "up" | "down" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={dir === "up" ? "M2.2 8.2 6 3.8l3.8 4.4" : "M2.2 3.8 6 8.2l3.8-4.4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Pick({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: readonly string[];
  onChange: (s: string) => void;
}) {
  const index = options.indexOf(value);
  const at = index < 0 ? 0 : index;
  return (
    <label className="tick-field">
      {label}
      <span className="tick-time">
        <button
          type="button"
          className="tick-step"
          aria-label={`Earlier ${label}`}
          disabled={at <= 0}
          onClick={() => {
            if (at > 0) onChange(options[at - 1]);
          }}
        >
          <StepArrow dir="down" />
        </button>
        <select aria-label={label} value={options.includes(value) ? value : options[0]} onChange={(e) => onChange(e.target.value)}>
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tick-step"
          aria-label={`Later ${label}`}
          disabled={at >= options.length - 1}
          onClick={() => {
            if (at < options.length - 1) onChange(options[at + 1]);
          }}
        >
          <StepArrow dir="up" />
        </button>
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Txt({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Area({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="span-3">
      {label}
      <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkline">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
