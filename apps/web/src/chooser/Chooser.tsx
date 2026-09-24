import { useState } from "react";
import { type AppPath, localStore, rememberStart, START_KEY } from "./start.js";

const CHOICES: { path: AppPath; title: string; detail: string; tint: string }[] = [
  {
    path: "/kiosk/",
    title: "Wall dashboard",
    detail: "The kiosk: clock, weather, calendar and everything else on the wall.",
    tint: "var(--tint-clock)",
  },
  {
    path: "/lights/",
    title: "Lights",
    detail: "Switch, dim and colour every bulb, and name, hide or reorder them.",
    tint: "var(--tint-lights)",
  },
];

function alreadyRemembered(): boolean {
  try {
    return localStore()?.getItem(START_KEY) != null;
  } catch {
    return false;
  }
}

/** The page at "/": pick an app, and optionally make this device always open it. */
export function Chooser() {
  const [always, setAlways] = useState(alreadyRemembered);

  const open = (path: AppPath) => {
    rememberStart(localStore(), always ? path : null);
    window.location.assign(path);
  };

  return (
    <main className="chooser">
      <h1 className="chooser__title">Home</h1>
      <ul className="chooser__list">
        {CHOICES.map((choice) => (
          <li key={choice.path}>
            <button
              type="button"
              className="chooser__card"
              style={{ background: choice.tint }}
              onClick={() => open(choice.path)}
            >
              <span className="chooser__name">{choice.title}</span>
              <span className="chooser__detail">{choice.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="chooser__always">
        <input type="checkbox" checked={always} onChange={(event) => setAlways(event.target.checked)} />
        Always open this on this device
      </label>
      <p className="chooser__hint">To come back here later, open /?choose.</p>
    </main>
  );
}
