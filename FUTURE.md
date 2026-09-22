# Deferred and future work

Things consciously left out of the first version, with the reasoning, so the
next person (or the next session) does not have to rediscover it.

## Deferred from v1

### Adding and editing calendar events (Google OAuth)
The original plan was full calendar CRUD from the wall. During setup on
2026-09-21 it became read-only: the calendar now reads each calendar's secret
iCal address, and the Google OAuth route was set aside.

**Why it was set aside.** An OAuth app has to be published to *In production*,
because one left in *Testing* issues refresh tokens that expire after 7 days -
the calendar would work for a week, then go blank. Publishing required
completing Google's branding verification first. The iCal feed covers reading
with none of that, so reading moved there and writing was deferred.

**What reviving it involves.**
- A Google Cloud project with the Calendar API enabled, and an OAuth client of
  type *Web application*.
- The `calendar.events` scope, which covers creating, editing and deleting.
- Getting through branding verification so the app can be published. Staying
  in Testing is not a real option for a wall display nobody re-authorises
  weekly. A Google Workspace account would sidestep this with an *Internal*
  app, if one is ever available.
- A one-time sign-in over an SSH tunnel, because Google refuses plain
  `http://` redirects on anything but `localhost`. Nothing else in the project
  signs in this way (TickTick uses a personal API token), so this flow and its
  redirect routes would be built fresh.

**How it should fit.** Writes go through the API. Reads can stay on the iCal
feed, or move to the API once a token exists, so a newly added event shows up
immediately rather than on the next feed poll.

### Gmail widget
Dropped from the MVP by choice, not by difficulty. The open question is privacy
rather than engineering: the dashboard hangs on a wall where family, guests and
anyone walking past can read it.

Three treatments worth considering, cheapest first:
- **Unread count and sender names only.** Signals that something needs
  attention without putting content on the wall. Can use the narrow
  `gmail.metadata` scope, which cannot read message bodies at all.
- **Subjects hidden until tapped.** Count and senders always visible, subject
  lines revealed on touch. Needs `gmail.readonly`.
- **Full preview.** Most useful, least private.

There is no iCal-style shortcut for mail, so Gmail depends on the Google OAuth
work above. Once that exists, Gmail is a scope added to the same client, plus a
provider and a widget.

### Spotify widget: built, waiting on Premium
The widget, its sign-in and its controls are built (see README). What stops
it working today is Spotify's rule, from February 2026, that a Development
Mode app is only served while the account that **owns** it has Premium; the
same change limits an app to five users and requires the redirect URI to be a
loopback IP (`http://127.0.0.1:8888/callback`), not `localhost`. On a free
account every call comes back 403 and the widget says "Needs Spotify Premium".

Nothing needs to change when an account is upgraded: the widget reads the
account's `product` and shows play, pause and skip only on Premium. If the
owner's Premium later lapses, it goes back to saying so.

Worth knowing if it is ever revived for real use: none of this has been
exercised against the live API, only against recorded response shapes, since
no Premium account was available. Check the 403 message still mentions
Premium; that is what tells "needs Premium" apart from other refusals.

## Known limitations

- **The iPad's backlight cannot be controlled from a web page.** The night
  profile changes what is on screen, not how bright the panel is. Real dimming
  is an iOS setting (Auto-Brightness) or a Shortcuts automation.
- **Only one bulb answered discovery** during setup. If a second KL135 never
  appears, check it is powered at the wall; if it works in the Kasa app but
  not here, its firmware has moved to KLAP and it needs the cloud path.
- **The calendar is read-only.** It reads secret iCal addresses; adding events
  needs the OAuth work described above.
- **Secrets are stored in plain text** in `.env`: the calendar's secret
  addresses and the TickTick API token, which can read and change the whole
  TickTick account. Acceptable for a LAN-only box; keep `.env` at `0600`.

## Ideas worth building next

- **A layout editor.** Settings can switch widgets on and off, but moving or
  resizing them still means editing `grid:` in `config.yaml`. Drag-and-drop on
  a touch screen fights with scrolling inside widgets, so a numeric editor
  (column, row, span) per widget is probably the better first step.
- **A PIN on settings**, if the wall ever sees visitors who shouldn't change it.
- **History.** The cache already writes every snapshot to SQLite with a
  timestamp; keeping those rows would give indoor/outdoor temperature graphs
  for free.
- **Assigning tasks from the wall.** TickTick's API already has assign and
  unassign endpoints, and the widget already knows the list's members; this is
  a picker on the task row.
- **Chore rotation** between the two people on the shared list.
- **Photo slideshow** as a third profile, for when nobody is home.
