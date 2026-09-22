import { useState, type FormEvent } from "react";
import type { Place } from "@home-dash/shared";
import { send } from "../lib/api.js";

/**
 * Finding somewhere on the map.
 *
 * Used for where the dashboard is, and for where it works out drive times to.
 * Both want the same thing - a name typed, a few candidates, one picked with
 * its coordinates and timezone - so it is one control rather than two that
 * drift apart.
 */
export function PlaceSearch({
  label,
  onPick,
}: {
  label: string;
  onPick: (place: Place) => void;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searched, setSearched] = useState("");
  const [state, setState] = useState<"idle" | "searching" | "failed">("idle");

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setState("searching");
    try {
      const { places: found } = (await send("GET", `/api/geocode?q=${encodeURIComponent(q)}`)) as { places: Place[] };
      setPlaces(found);
      setSearched(q);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  const pick = (place: Place) => {
    onPick(place);
    setPlaces(null);
    setQuery("");
  };

  return (
    <>
      <div className="settings__lead">
        <form className="settings__search" onSubmit={search}>
          <input
            className="field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={label}
            aria-label={label}
            enterKeyHint="search"
          />
          <button type="submit" className="button" disabled={state === "searching" || query.trim().length < 2}>
            {state === "searching" ? "Searching" : "Search"}
          </button>
        </form>
        {state === "failed" && <p className="settings__error">Couldn&rsquo;t search just now. Try again.</p>}
      </div>
      {places?.length === 0 && (
        <p className="settings__empty">No places called &ldquo;{searched}&rdquo;. Try a nearby larger town.</p>
      )}
      {places?.map((place) => (
        <button key={`${place.lat},${place.lon}`} type="button" className="settings__place" onClick={() => pick(place)}>
          <span className="settings__label">
            {place.label}
            <span className="settings__detail">{place.detail}</span>
          </span>
          <span className="settings__choose">Use</span>
        </button>
      ))}
    </>
  );
}
