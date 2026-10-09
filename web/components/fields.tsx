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
