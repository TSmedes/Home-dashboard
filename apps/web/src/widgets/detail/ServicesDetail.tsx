import type { ServicesSnapshot } from "@home-dash/shared";
import { containerState, summary, serviceRows } from "../services.js";
import type { WidgetProps } from "../types.js";
import { Section } from "./parts.js";

const STATE_WORD = { up: "Up", warn: "Degraded", down: "Down" } as const;
const ORDER = { down: 0, warn: 1, up: 2 } as const;

/** Every container and URL check, with Docker's own words and each check's answer. */
export function ServicesDetail({ envelope }: WidgetProps<ServicesSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;

  const containers = [...(data.containers ?? [])]
    .map((c) => ({ ...c, level: containerState(c) }))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.name.localeCompare(b.name));
  const checks = [...data.checks].sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
  const rows = serviceRows(data);

  return (
    <div className="detail servd">
      <p className="services__summary" data-ok={rows.every((r) => r.state === "up")}>
        {summary(rows)}
      </p>

      {(data.containers !== null || data.dockerError) && (
        <Section title="Containers" aside={data.containers ? `${data.containers.length}` : undefined}>
          {data.dockerError && <p className="services__note">Docker: {data.dockerError}</p>}
          <ul className="servd__list">
            {containers.map((c) => (
              <li key={c.name} className="servd__row" data-state={c.level}>
                <span className="services__dot" role="img" aria-label={STATE_WORD[c.level]} />
                <span className="servd__name">{c.name}</span>
                <span className="servd__sub">{c.image}</span>
                <span className="servd__status">
                  {c.status}
                  {c.health && <span className="servd__health"> · {c.health}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {checks.length > 0 && (
        <Section title="Web checks" aside={`${checks.length}`}>
          <ul className="servd__list">
            {checks.map((c) => (
              <li key={c.id} className="servd__row" data-state={c.ok ? "up" : "down"}>
                <span className="services__dot" role="img" aria-label={c.ok ? "Up" : "Down"} />
                <span className="servd__name">{c.name}</span>
                <span className="servd__sub">{c.url}</span>
                <span className="servd__status tnum">
                  {c.status !== null && `HTTP ${c.status}`}
                  {c.latencyMs !== null && ` · ${c.latencyMs} ms`}
                  {c.error && <span className="servd__error"> {c.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
