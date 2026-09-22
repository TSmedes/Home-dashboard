# Home dashboard

A self-hosted wall dashboard for a mounted iPad: the time, local weather, your
calendar, the shared to-do list, and the lights. Runs in Docker on a home
server, reachable only on your own network.

Built for a specific screen — an iPad mini (1024×768 landscape, touch) — and a
specific place, Snoqualmie, WA. Both are settings, not assumptions baked into
the code.

## What makes it behave well on a wall

- **One broken API degrades one tile.** A failed refresh keeps serving the last
  good value, marked with the time it was true. Nothing goes blank.
- **It boots showing real data.** Snapshots are cached in SQLite, so a restart
  repaints immediately instead of showing five spinners.
- **Day and night are separate dashboards.** Each profile has its own widgets,
  layout and theme, switched on a schedule by the server — so the iPad wakes up
  already showing the right one.
- **Editing `config.yaml` reloads live.** A typo keeps the previous config
  instead of taking the display down.

## Quick start

```bash
git clone <this repo> && cd home-dash
docker compose up -d
```

Open `http://<your-server>:8080`. The clock and weather work immediately — they
need no credentials. Set your location in `config/config.yaml`; it reloads as
soon as you save.

For the calendar, tasks and lights, run the setup wizard, which walks you
through each account one step at a time and writes `.env` for you:

```bash
npm install
npm run setup
```

## The calendar

The calendar is read from each Google calendar's **secret iCal address**, a
private link Google serves your events from. No Google Cloud project, no OAuth
app, no sign-in. The wizard asks you to paste each address and checks it
against Google before saving it.

- **It is read-only.** Events show on the wall; they cannot be added from it.
  Adding events needs Google OAuth, which is parked in [FUTURE.md](FUTURE.md)
  along with why it was set aside.
- **Each address is a password.** Anyone who has it can read every event on
  that calendar, which is why it lives in `.env` rather than `config.yaml`. If
  one leaks, reset it where you copied it from (the calendar's settings →
  *Integrate calendar*) and run `npm run setup` again.

## TickTick

The tasks widget uses a **personal API token**, which TickTick provides for
exactly this kind of personal use. There is no developer app to register and
no sign-in flow; the wizard asks for the token and checks it against TickTick
before saving it.

Who each task is assigned to comes from the list's members in TickTick, so
names stay correct without anything to maintain in `config.yaml`.

On the wall, overdue tasks and tasks due today are called out, and **Add a
task** puts a new one straight into the configured list. Ticking a task does
not complete it at once: it shows as done with an **Undo** for four seconds
first, because a wall panel gets brushed past. Give a tasks widget
`options: { assignee: <TickTick username> }` for a view of one person's tasks.

The token can read and change your whole TickTick account, which is why it
lives in `.env`. If it leaks, revoke it in TickTick (Settings → Account →
API Token) and run `npm run setup` again.

## Kasa bulbs

Find them and get a config block to paste:

```bash
npm run find-kasa
```

Run it **on the host**, not in the container: Docker's bridge network does not
carry the broadcast that Kasa discovery uses. Day-to-day control works fine
from the container, because that talks to each bulb's address directly — which
is why the addresses go in `config.yaml` and should be reserved in your router
so a reboot does not renumber them.

A bulb that works in the Kasa app but never appears has newer firmware using
TP-Link's encrypted KLAP handshake. Set `KASA_USERNAME` / `KASA_PASSWORD` to
fall back to the cloud path.

## Configuration

`config/config.yaml` holds settings; `.env` holds secrets. Nothing secret is
ever written into the YAML, so it stays safe to read, diff and commit.

Layout is a 12-column grid. Each widget declares where it sits:

```yaml
profiles:
  day:
    schedule: { from: "06:30", to: "21:30" }
    theme: light
    widgets:
      - id: agenda
        type: calendar
        grid: { col: 1, row: 3, colSpan: 5, rowSpan: 4 }
        options: { days: 3 }
```

Widgets can also **share** a row instead of claiming columns. Give them the
same `row`/`rowSpan` and `share: true`, and whichever are switched on split
the full width evenly, so switching one off in settings widens the others
instead of leaving a gap. The night screen's bottom row works this way:

```yaml
      - id: weather
        type: weather
        grid: { row: 5, rowSpan: 2, share: true }
      - id: lights
        type: lights
        enabled: false
        grid: { row: 5, rowSpan: 2, share: true }
```

Widgets adapt to small tiles: a narrow weather tile stacks its figures, and a
short lights tile keeps the on/off switches but drops the brightness sliders.

### Pages

A profile can have more than one page. Pages sit side by side and change with
a swipe; dots along the bottom show where you are and can be tapped. Give a
widget `page: 2` to put it on the second page. Each page has its own 12-column
grid, and a widget without `page` is on page 1, so an existing config is one
page until you say otherwise.

```yaml
      - id: river
        type: river
        page: 2
        grid: { col: 1, row: 1, colSpan: 5, rowSpan: 3 }
```

After `returnToFirstPage` seconds without a touch (120 by default, `0` for
never) the screen slides back to page 1, so the wall doesn't sit on page three
all afternoon. Switching between day and night also starts again on page 1. A
page whose widgets are all switched off is skipped rather than shown blank.

A profile whose `from` is later than its `to` wraps past midnight, which is how
the night window is written. Overlapping windows resolve to whichever profile
appears first in the file.

The settings screen writes back to this same file as small, targeted edits:
it changes only the value you touched and leaves every other character alone,
comments and their alignment included. Turning a setting back to its default
removes the line it added, so the file ends up exactly as you wrote it.

## More widgets

These need nothing beyond `config.yaml` unless noted. The example config puts
all of them on the day screen's second page.

- **River level** (`river`): the Snoqualmie River at Snoqualmie Falls from
  NOAA's water prediction service. It shows the latest reading, whether it's
  rising or falling, the next flood threshold and the forecast peak, with a
  48-hour chart and three days of forecast. No key. Change `river.gauge` to
  any NWS gauge id from water.noaa.gov.
- **Sun & moon** (`sunmoon`): sunrise, sunset, day length and how it compares
  with yesterday, the moon's phase and the next full or new moon. Worked out
  locally from `location`.
- **Bin day** (`bins`): the next pickup for each bin from the rules under
  `bins:`, weekly or every few weeks, with holiday shifts and skips. From 4pm
  the day before, it says which bins to put out tonight.
- **Countdowns** (`countdowns`): days until the dates under
  `countdowns.items`, plus any calendar event with `#countdown` in its title.
  A yearly event counts down to its next occurrence only.
- **Commute** (`commute`): drive time with live traffic to each place under
  `commute.destinations`, with the traffic delay and arrival time. Needs a free
  TomTom key (`TOMTOM_API_KEY`); `npm run setup` walks through it.
- **Spotify** (`spotify`): what's playing, with album art and progress, plus
  play, pause and skip on Premium. Needs `SPOTIFY_CLIENT_ID` from a Spotify
  developer app (the wizard walks through creating one), then **Connect
  Spotify** in settings. Spotify sends you to `http://127.0.0.1:8888/callback`,
  a page that won't load; copy that address back into settings to finish. The
  sign-in is kept in the database, not `.env`.

  Since February 2026 Spotify only serves a developer app while its **owner has
  Premium**. On a free account the widget says so rather than failing
  silently, and it starts working once the account is upgraded.

## Settings

The gear in the top-left corner opens settings. It covers:

- **Night mode**: switch to the night screen now (or back to day). A manual
  switch lasts until the next scheduled switch, then the schedule takes over
  again by itself, so forcing night at 8pm never leaves the wall dark the next
  morning. It isn't saved to `config.yaml`; it's temporary state on the server.
- **Schedule and display**: when day and night start, 12/24-hour clock, °F/°C.
- **Location**: search for a town; sets the weather location and timezone
  together, using Open-Meteo's free place search.
- **Lights**: rename a bulb, or hide it (a hidden bulb isn't polled either).
- **Widgets**: switch each widget on or off, separately for the day and night
  screens and grouped by page. A switched-off widget leaves its space empty.
- **Spotify**: connect or disconnect the Spotify account, once
  `SPOTIFY_CLIENT_ID` is set.
- **Status**: when each source last updated, and its error if it failed.

Settings closes itself after two minutes without a touch, so the wall never
stays stuck on it. As with the rest of the dashboard there is no login:
anyone on your network can change them.

## Adding a widget

Two files, no framework surgery:

1. A component in `apps/web/src/widgets/`, plus one entry in
   `widgets/registry.ts`.
2. If it needs server data, one entry in
   `apps/server/src/providers/index.ts`. Return `null` from `create` when the
   integration is not configured and the widget shows a setup prompt instead of
   retrying a doomed request forever.

The source key and the widget type are the same string; that is how a widget
finds its data.

## Development

```bash
npm install
npm run dev        # server on :8080, Vite on :5173 with live reload
npm test           # unit tests
npm run typecheck
```

`npm run dev` also serves Vite on your LAN address, so you can point the real
iPad at it while working.

## Operations

- `GET /api/health` — per-provider status, last fetch time and last error.
  The first place to look when a tile looks stale.
- `data/dashboard.db` — the last good data from each source, which is how the
  dashboard repaints instantly after a restart. Safe to delete; it refills on
  the next poll.
- `.env` — every secret: the calendar addresses and the TickTick token, stored
  unencrypted. Acceptable on a LAN-only box; keep it at `0600`.
- Multi-arch image, no native dependencies (storage is Node's built-in
  `node:sqlite`), so it builds for a Pi as easily as for an x86 server:

  ```bash
  docker buildx build --platform linux/amd64,linux/arm64 -t home-dash .
  ```

## On the iPad

Open the dashboard in Safari, then Share → **Add to Home Screen**. Launching
from that icon runs it full-screen with no browser chrome. Guided Access
(Settings → Accessibility) locks the iPad to it.

Note that a web page cannot control the iPad's backlight. The night profile
changes what is displayed, not screen brightness — for that, use
Auto-Brightness or a Shortcuts automation.

## What is not here yet

- **Adding calendar events from the wall** needs Google OAuth. See
  [FUTURE.md](FUTURE.md) for why it was set aside and what reviving it involves.
- **Gmail** was deliberately left out; FUTURE.md explains why.
