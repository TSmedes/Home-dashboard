import type { ServicesSnapshot } from "@home-dash/shared";
import { serviceRows, summary } from "./services.js";
import type { WidgetProps } from "./types.js";

const STATE_WORD = { up: "Up", warn: "Degraded", down: "Down" } as const;

/**
 * Every container and URL check in one list, problems at the top, so a
 * glance at the first row says whether anything needs attention.
 */
export function ServicesWidget({ envelope }: WidgetProps<ServicesSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const rows = serviceRows(data);
  const allUp = rows.every((r) => r.state === "up");

  return (
    <div className="services">
      <p className="services__summary" data-ok={allUp}>
        {summary(rows)}
      </p>
      {rows.length > 0 && (
        <ul className="services__list">
          {rows.map((row) => (
            <li key={row.key} className="services__row" data-state={row.state}>
              <span className="services__dot" role="img" aria-label={STATE_WORD[row.state]} />
              <span className="services__name">{row.name}</span>
              <span className="services__detail tnum">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {data.dockerError && <p className="services__note">Docker: {data.dockerError}</p>}
    </div>
  );
}
