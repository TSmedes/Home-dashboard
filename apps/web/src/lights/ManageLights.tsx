import type { LightConfig } from "@home-dash/shared";
import { CommitInput, Switch } from "../settings/controls.js";
import type { Save } from "./LightsApp.js";
import { moveChanges } from "./manage.js";

/**
 * Every bulb in config.yaml, hidden ones included: rename, show or hide, and
 * put them in the order the dashboard and this app list them.
 */
export function ManageLights({ lights, save }: { lights: LightConfig[]; save: Save }) {
  if (lights.length === 0) {
    return (
      <div className="lapp__empty">
        <p className="boot__headline">No lights yet.</p>
        <p className="boot__detail">Add your bulbs under lights: in config.yaml, or run npm run setup.</p>
      </div>
    );
  }

  const move = (id: string, by: -1 | 1) => void save(moveChanges(lights, id, by), "Moved").catch(() => undefined);

  return (
    <ul className="lmanage">
      {lights.map((light, index) => (
        <li className="lmanage__row" key={light.id} data-hidden={light.hidden}>
          <div className="lmanage__main">
            <CommitInput
              label={`Name for the bulb at ${light.host}`}
              value={light.name}
              onCommit={(name) =>
                void save([{ path: ["lights", { id: light.id }, "name"], value: name }], `Renamed to ${name}`).catch(
                  () => undefined,
                )
              }
            />
            <span className="lmanage__detail">
              {light.type === "tapo" ? "Tapo" : "Kasa"} · {light.host}
              {light.hidden && " · hidden"}
            </span>
          </div>

          <div className="lmanage__controls">
            <Switch
              checked={!light.hidden}
              label={`Show ${light.name}`}
              onChange={(show) =>
                save(
                  [{ path: ["lights", { id: light.id }, "hidden"], value: show ? null : true }],
                  show ? `${light.name} shown` : `${light.name} hidden`,
                )
              }
            />
            <div className="lmanage__order">
              <button
                type="button"
                className="lmanage__move"
                aria-label={`Move ${light.name} up`}
                disabled={index === 0}
                onClick={() => move(light.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="lmanage__move"
                aria-label={`Move ${light.name} down`}
                disabled={index === lights.length - 1}
                onClick={() => move(light.id, 1)}
              >
                ↓
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
