import type { ContainerStatus, ServicesSnapshot } from "@home-dash/shared";
import { useHostname } from "../../lib/useHostname.js";
import { containerState, portLabel, summary, serviceRows } from "../services.js";
import type { WidgetProps } from "../types.js";
import { Section } from "./parts.js";

const STATE_WORD = { up: "Up", warn: "Degraded", down: "Down" } as const;
const ORDER = { down: 0, warn: 1, up: 2 } as const;

type Ranked = ContainerStatus & { level: "up" | "warn" | "down" };

const rank = (containers: ContainerStatus[]): Ranked[] =>
  containers
    .map((c) => ({ ...c, level: containerState(c) }))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.name.localeCompare(b.name));

/** A compose project's name, as a heading: "firefly" reads as "Firefly". */
const heading = (project: string) => project.charAt(0).toUpperCase() + project.slice(1);

function ContainerRow({ c, hostname }: { c: Ranked; hostname: string }) {
  // Every published port, not just the first: the expanded view is where you
  // go to find the one you half-remember.
  const addresses = c.state === "running" ? c.ports.map((p) => portLabel(p, hostname)) : [];
  return (
    <li className="servd__row" data-state={c.level}>
      <span className="services__dot" role="img" aria-label={STATE_WORD[c.level]} />
      <span className="servd__name">{c.name}</span>
      <span className="servd__sub">
        {addresses.length > 0 ? <span className="servd__address tnum">{addresses.join(" · ")}</span> : c.image}
      </span>
      <span className="servd__status">
        {c.status}
        {c.health && <span className="servd__health"> · {c.health}</span>}
      </span>
    </li>
  );
}

/**
 * Every container and URL check, with Docker's own words and each check's
 * answer. Compose stacks get a heading of their own, so Firefly's four
 * containers read as one service you can look inside.
 */
export function ServicesDetail({ envelope }: WidgetProps<ServicesSnapshot>) {
  const hostname = useHostname();
  const data = envelope?.data;
  if (!data) return null;

  const all = data.containers ?? [];
  const projects = new Map<string, ContainerStatus[]>();
  for (const c of all) {
    if (!c.project) continue;
    const kin = projects.get(c.project);
    if (kin) kin.push(c);
    else projects.set(c.project, [c]);
  }
  // A project of one is just a container; it stays in the loose list.
  const stacks = [...projects.entries()].filter(([, members]) => members.length > 1);
  const grouped = new Set(stacks.flatMap(([, members]) => members.map((c) => c.name)));
  const loose = rank(all.filter((c) => !grouped.has(c.name)));

  const checks = [...data.checks].sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
  const rows = serviceRows(data, hostname);

  return (
    <div className="detail servd">
      <p className="services__summary" data-ok={rows.every((r) => r.state === "up")}>
        {summary(rows)}
      </p>

      {(data.containers !== null || data.dockerError) && (
        <Section title="Containers" aside={data.containers ? `${data.containers.length}` : undefined}>
          {data.dockerError && <p className="services__note">Docker: {data.dockerError}</p>}

          {stacks
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([project, members]) => (
              <div className="servd__stack" key={project}>
                <h4 className="servd__stack-name">
                  {heading(project)}
                  <span className="servd__stack-count">{members.length}</span>
                </h4>
                <ul className="servd__list">
                  {rank(members).map((c) => (
                    <ContainerRow key={c.name} c={c} hostname={hostname} />
                  ))}
                </ul>
              </div>
            ))}

          {loose.length > 0 && (
            <ul className="servd__list">
              {loose.map((c) => (
                <ContainerRow key={c.name} c={c} hostname={hostname} />
              ))}
            </ul>
          )}
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
