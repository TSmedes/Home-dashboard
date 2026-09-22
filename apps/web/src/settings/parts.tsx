import type React from "react";

/**
 * The two shapes every settings screen is built from.
 *
 * They live here rather than in SettingsPanel because the edit-mode widget
 * panel is the same furniture with different contents, and a second copy would
 * drift away from the stylesheet the moment either one was touched.
 */

/** A titled card. One subject per section, so a heading is always worth reading. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <h2 className="settings__heading">{title}</h2>
      <div className="settings__card">{children}</div>
    </section>
  );
}

/** A labelled line with its control on the right. `detail` explains the label underneath. */
export function Row({ label, detail, children }: { label: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="settings__row">
      <span className="settings__label">
        {label}
        {detail && <span className="settings__detail">{detail}</span>}
      </span>
      <span className="settings__control">{children}</span>
    </div>
  );
}
