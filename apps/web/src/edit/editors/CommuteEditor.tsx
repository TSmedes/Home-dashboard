import type { CommuteDestination, DashboardConfig } from "@home-dash/shared";
import { CommitInput } from "../../settings/controls.js";
import { Row, Section } from "../../settings/parts.js";
import { PlaceSearch } from "../../settings/PlaceSearch.js";
import type { WidgetConfigProps } from "../../widgets/types.js";

/** TomTom's free tier is priced per destination, so the schema caps it at five. */
const MAX = 5;

/** An id from a name, kept readable in the file and unique among the rest. */
function idFor(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "place";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/**
 * Where the dashboard works out drive times to.
 *
 * A destination is a name and a point on the map, so adding one is the same
 * town search the location setting uses. The name is editable afterwards
 * because "Snoqualmie, Washington" is not what you want on a tile that has to
 * be read across a room - "Work" is.
 */
export function CommuteEditor({ config, update }: WidgetConfigProps) {
  const destinations = config.commute.destinations;

  const setDestinations = (next: CommuteDestination[]) =>
    update((draft: DashboardConfig) => ({ ...draft, commute: { ...draft.commute, destinations: next } }));

  return (
    <Section title="Drive times to">
      {destinations.length === 0 && <p className="settings__empty">Nowhere yet.</p>}

      {destinations.map((destination) => (
        <Row key={destination.id} label={destination.name}>
          <div className="editor-row">
            <CommitInput
              value={destination.name}
              label={`What to call ${destination.name}`}
              onCommit={(name) =>
                setDestinations(destinations.map((d) => (d.id === destination.id ? { ...d, name } : d)))
              }
            />
            <button
              type="button"
              className="button button--quiet"
              aria-label={`Remove ${destination.name}`}
              onClick={() => setDestinations(destinations.filter((d) => d.id !== destination.id))}
            >
              Remove
            </button>
          </div>
        </Row>
      ))}

      {destinations.length >= MAX ? (
        <p className="settings__empty">
          Five is the most it will work out at once. Remove one to add another.
        </p>
      ) : (
        <PlaceSearch
          label="Search for somewhere to drive to"
          onPick={(place) =>
            setDestinations([
              ...destinations,
              {
                id: idFor(place.label, destinations.map((d) => d.id)),
                // The short name: a tile read across a room has no room for
                // "Snoqualmie, Washington".
                name: place.label.split(",")[0]!.trim(),
                lat: place.lat,
                lon: place.lon,
              },
            ])
          }
        />
      )}
    </Section>
  );
}
