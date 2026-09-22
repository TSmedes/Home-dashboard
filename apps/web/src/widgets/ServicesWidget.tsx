import type { ServicesSnapshot } from "@home-dash/shared";
import { useHostname } from "../lib/useHostname.js";
import { serviceRows, serviceTree, summary, type ServiceRow } from "./services.js";
import type { WidgetProps } from "./types.js";

const STATE_WORD = { up: "Up", warn: "Degraded", down: "Down" } as const;

function Row({ row, nested }: { row: ServiceRow; nested?: boolean }) {
  return (
    <li className="services__row" data-state={row.state} data-nested={nested}>
      <span className="services__dot" role="img" aria-label={STATE_WORD[row.state]} />
      <span className="services__name">{row.name}</span>
      <span className="services__detail tnum">{row.address ?? row.detail}</span>
    </li>
  );
}

/**
 * Every container and URL check in one list, problems at the top, so a
 * glance at the first row says whether anything needs attention.
 *
 * A compose stack costs one row, not one per container - but any member of it
 * that needs a look is named underneath, so the tile never hides a problem
 * behind a tidy summary.
 */
export function ServicesWidget({ envelope }: WidgetProps<ServicesSnapshot>) {
  const hostname = useHostname();
  const data = envelope?.data;
  if (!data) return null;
  const nodes = serviceTree(data, hostname);
  const rows = serviceRows(data, hostname);
  const allUp = rows.every((r) => r.state === "up");

  return (
    <div className="services">
      <p className="services__summary" data-ok={allUp}>
        {summary(rows)}
      </p>
      {nodes.length > 0 && (
        <ul className="services__list">
          {nodes.map((node) =>
            node.kind === "group" ? (
              <li key={node.key} className="services__group">
                <ul className="services__list">
                  <Row row={{ ...node, kind: "container" }} />
                  {node.members
                    .filter((m) => m.state !== "up")
                    .map((member) => (
                      <Row key={member.key} row={member} nested />
                    ))}
                </ul>
              </li>
            ) : (
              <Row key={node.key} row={node} />
            ),
          )}
        </ul>
      )}
      {data.dockerError && <p className="services__note">Docker: {data.dockerError}</p>}
    </div>
  );
}
