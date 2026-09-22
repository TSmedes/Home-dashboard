import { useEffect, useState } from "react";

/**
 * An on/off switch that answers the tap at once. The saved value arrives a
 * moment later over the live connection; until then the tap is shown, so the
 * control never appears to ignore a finger.
 */
export function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => setPending(null), [checked]);
  const shown = pending ?? checked;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label={label}
      className="switch"
      onClick={() => {
        setPending(!shown);
        onChange(!shown).catch(() => setPending(null));
      }}
    >
      <span className="switch__knob" aria-hidden="true" />
    </button>
  );
}

/** A small set of mutually exclusive choices, e.g. 12-hour / 24-hour. */
export function Segmented<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="segmented__option"
          onClick={() => option.value !== value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A text field that saves when you finish with it - on Enter or on tapping
 * away - rather than on every keystroke.
 */
export function CommitInput({
  value,
  label,
  onCommit,
  type = "text",
}: {
  value: string;
  label: string;
  onCommit: (next: string) => void;
  type?: "text" | "time" | "date";
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (!next) return setDraft(value); // an emptied field goes back, not blank
    if (next !== value) onCommit(next);
  };

  const className = type === "text" ? "field" : `field field--${type}`;

  return (
    <input
      className={className}
      type={type}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}
