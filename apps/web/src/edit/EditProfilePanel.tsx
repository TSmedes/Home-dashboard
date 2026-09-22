import { useEffect } from "react";
import type { DashboardConfig } from "@home-dash/shared";
import { CommitInput, Segmented } from "../settings/controls.js";
import { profileLabel } from "../settings/model.js";
import { Row, Section } from "../settings/parts.js";
import { addProfile, canAddProfile, removeProfile, setProfileStart } from "./profiles.js";

interface Props {
  config: DashboardConfig;
  /** The screen being laid out, so removing it can move on to another. */
  current: string;
  update: (recipe: (draft: DashboardConfig) => DashboardConfig) => void;
  onSwitch: (name: string) => void;
  onClose: () => void;
}

/**
 * The screens the dashboard switches between, and when.
 *
 * Their windows have to cover the day exactly once, so the times are not free
 * text: moving when a screen starts moves the end of whatever ran before it,
 * adding one halves the longest window, and removing one gives its time back
 * to the screen before it. Nothing on the server enforces that - it shows the
 * first profile when no window matches - so a gap would be a wall quietly
 * showing the wrong screen rather than an error.
 */
export function EditProfilePanel({ config, current, update, onSwitch, onClose }: Props) {
  const names = Object.keys(config.profiles);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="edit-picker" role="dialog" aria-modal="true" aria-label="Screens">
      <div className="edit-picker__backdrop" onClick={onClose} />
      <div className="edit-picker__panel edit-picker__panel--wide">
        <header className="edit-picker__head">
          <h2 className="edit-picker__title">Screens</h2>
          <button type="button" className="button button--primary" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="edit-picker__scroll">
          <Section title="When each screen shows">
            {names.map((name) => {
              const profile = config.profiles[name]!;
              return (
                <Row
                  key={name}
                  label={profileLabel(name)}
                  detail={`Until ${profile.schedule.to}`}
                >
                  <div className="editor-row">
                    <CommitInput
                      value={profile.schedule.from}
                      label={`When the ${profileLabel(name).toLowerCase()} screen starts`}
                      type="time"
                      onCommit={(from) => update((draft) => setProfileStart(draft, name, from))}
                    />
                    <Segmented
                      label={`Theme for the ${profileLabel(name).toLowerCase()} screen`}
                      value={profile.theme}
                      options={[
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ]}
                      onChange={(theme) =>
                        update((draft) => ({
                          ...draft,
                          profiles: { ...draft.profiles, [name]: { ...profile, theme } },
                        }))
                      }
                    />
                    {names.length > 1 && (
                      <button
                        type="button"
                        className="button button--quiet"
                        aria-label={`Remove the ${profileLabel(name).toLowerCase()} screen`}
                        onClick={() => {
                          update((draft) => removeProfile(draft, name));
                          if (name === current) onSwitch(names.find((other) => other !== name)!);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </Row>
              );
            })}
          </Section>

          <div className="settings__lead">
            <button
              type="button"
              className="button"
              disabled={!canAddProfile(config)}
              onClick={() => update((draft) => addProfile(draft, "evening"))}
            >
              Add a screen
            </button>
            <p className="settings__empty">
              A new screen takes half of whichever window is longest, and starts with a clock on it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
