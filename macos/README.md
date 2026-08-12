# Solar Wallpaper — native macOS host

A thin native shell that renders the **live-macos-wallpaper** web app onto the
macOS desktop, behind the Finder's icons.

The host lives in the same repository as the page it renders, because the
~20-name bridge between them is a single contract split across two languages:
`WallpaperBridge` in `app.js` and its callers here. One commit changes both
sides, so it is impossible to land half of a rename — which would otherwise
fail silently, with a menu item quietly doing nothing and no error anywhere.

Nothing is copied or bundled. The app loads `../index.html` in place, so
editing the page updates the live wallpaper within a couple of seconds. The
web version remains completely standalone: it does not depend on this folder
and still opens in a browser with no build step.

- Web app: the parent directory
- Native host: this folder
- Built app: `/Applications/SolarWallpaper.app`
- Log: `~/Library/Logs/SolarWallpaper.log`

## Build and run

```bash
./macos/build.sh --run
```

No Xcode project and no Xcode.app required — `swiftc` compiles the sources and
the script assembles the `.app` bundle and ad-hoc signs it. Command Line Tools
are enough.

### Environment overrides

| Variable | Default | Effect |
| --- | --- | --- |
| `SOLAR_WALLPAPER_WEB_DIR` | `~/Documents/GitHub/live-macos-wallpaper` | Where to load `index.html` from |
| `SOLAR_WALLPAPER_FPS` | `10` | Idle frame rate; accelerated time and Zen use `max(fps, 20)` |
| `SOLAR_WALLPAPER_SCENE` | `500` | Scene cache staleness in ms; `0` disables the cache |
| `SOLAR_WALLPAPER_ZEN_FPS` | `15` | Frame rate during an animation |
| `SOLAR_WALLPAPER_IDLE` | unset | Overrides the idle delay in seconds, for testing |
| `SOLAR_WALLPAPER_DPR` | `1.0` | Caps `devicePixelRatio`, so it caps canvas resolution |
| `SOLAR_WALLPAPER_MAIN_ONLY` | unset | `1` renders only on the main display |
| `SOLAR_WALLPAPER_STUDIO` | unset | `1` opens the Studio window at launch |
| `SOLAR_WALLPAPER_SELFTEST` | unset | `bridge` exercises every bridge command; `studio` proves the studio → desktop round-trip |

```bash
open --env SOLAR_WALLPAPER_FPS=20 /Applications/SolarWallpaper.app
```

## Status

**Milestones 1–6 and 8 done.** The wallpaper renders behind desktop icons on every
display, keeps real time, is controllable from the menu bar, and has a fully
interactive Studio window. Remaining: the preset browser (7).

## Studio window

`🪐 → Open Studio…` (⌘S). An ordinary app window running the same scene, where
dragging, scrolling and all sixteen keyboard shortcuts work normally, because
unlike the desktop layer it accepts events.

| Button | Does |
| --- | --- |
| **Apply to Desktop** (↩) | Pushes this composition to every display |
| **Match Desktop** | Pulls the desktop's composition into the studio |
| **Copy Preset** | Puts the camera line on the clipboard for `VIEWS` |
| **Reset View** | Back to the selected preset |

A live `presetLine()` readout runs along the bottom, so the exact numbers you
would paste into `app.js` are always visible while composing.

Transfer goes through `WallpaperBridge.snapshot()` / `apply()` rather than
screen-scraping the camera: framing index and camera, both the solar-system and
Earth Focus cameras, Earth lighting, labels, orbits and speed. Zen is excluded
on purpose — it is a presentation state, not part of a composition.

Two behaviours differ from the desktop, both deliberate: the page's own control
bar is visible and clickable here, and **idle Zen is off**, because composing a
shot means sitting still and being ambushed by the screensaver mid-adjustment
is not helpful.

While the studio is open the app switches to a regular activation policy, so it
gets a Dock icon and a real menu bar with ⌘W and ⌘Q. Closing it drops back to
menu-bar-only.

## Idle animation

`🪐 → Idle Animation`: **Never / 1 / 2 / 5 / 10 minutes**, and which of the
three animations to run. Default is Astronomical after 2 minutes. Both settings
persist in `UserDefaults`.

**Idleness is measured on the machine, not the window.** The page's own
45-second idle timer cannot work on the desktop layer: that window never
receives a pointer or key event, so "idle" latches on immediately and never
releases — which is exactly what happened before, running the calendar away
from today at six hours per second. Real idle time comes from
`CGEventSource.secondsSinceLastEventType(.hidSystemState, …)`, sampled once a
second, and is pushed into the page.

There is no "any input" event type that survives `CGEventType(rawValue:)`, so
the individual types are listed and the minimum taken — each carries its own
timestamp, so the most recent activity is the smallest.

Two distinct behaviours, deliberately:

| Started by | Stops when |
| --- | --- |
| **Idle** — the Mac went untouched | The first keypress or mouse move |
| **Hand** — `🪐 → Zen` | You change it back by hand |

An animation you chose is never torn down by the idle logic. Leaving an idle
animation also calls `today()`, so the calendar snaps back from wherever the
animation ran it to.

Displays going to sleep stops an idle animation — rendering onto a sleeping
screen is pure waste. Waking returns the scene to today.

**Animations cost more than the static wallpaper**, because the camera moves
every frame and the scene cache cannot help. Frame rate during an animation is
therefore 15 rather than 20: two displays measurably saturate above ~15 fps,
where output collapses to a few frames a second instead of degrading, so the
lower number both looks better and costs less.

## Energy gating

The wallpaper stops painting entirely — no clear, no blit, no draw calls, the
`requestAnimationFrame` loop still ticking so it can resume instantly — when
nothing can see it:

| Trigger | Detected by |
| --- | --- |
| Screen fully covered by other windows | Window-list coverage sampling, per display, every 2 s |
| Displays asleep | `NSWorkspace.screensDidSleepNotification` |
| Screen locked | `com.apple.screenIsLocked` on the distributed centre |

Each display is judged independently, so a full-screen editor on one monitor
does not pause the wallpaper on the other.

Resuming forces a fresh ephemeris and a full repaint, because arbitrary time
may have passed — measured back on the correct date within one poll.

Toggle with `🪐 → Pause When Covered`; the setting persists.

### Why not `NSWindow.occlusionState`

It does not work here. It reported `.visible` continuously for the wallpaper
windows even with the desktop entirely covered, which on reflection is correct:
a desktop-level window is never "occluded" in the sense AppKit means, it is
underneath everything by design.

Coverage is therefore computed from `CGWindowListCopyWindowInfo`, keeping only
layer-0 windows (ordinary app windows — panels, the Dock and the menu bar sit
above that and should not count), belonging to other processes, at least 90%
opaque and larger than 80×80. The screen is then sampled on a 24×14 grid and
called covered past 95%.

Grid sampling rather than an exact rectangle union: it is simpler, cheap at
this rate, and correctly handles several windows tiling together to cover a
screen. No Screen Recording permission is needed — window geometry is readable
without it, only titles are withheld.

## Which side do I change?

The animation is **entirely** `app.js`. The Swift host draws nothing — it is a
window with buttons on it. The dependency runs one way: Swift needs the page,
the page does not need Swift.

| Change | Touch |
| --- | --- |
| Colours, textures, brushwork, astronomy, frame rates | `app.js` only |
| **Add a framing to `VIEWS`** | `app.js` only — it appears in the menu by itself |
| Add a speed or a Zen mode | `app.js` only — same |
| Window placement, idle timing, occlusion, Studio, menu layout | Swift only |
| **A new thing the menu should control** | **both** — a bridge function and its caller |

The menu is generated from `views()`, `speeds()` and `zenModes()` rather than
duplicating those lists in Swift, which is what keeps the first three rows
honest. The only genuine coupling is the ~20 bridge names, and it is sharp:
rename one side and a menu item silently stops working, with no error.

### Two bugs that were hiding behind this

Verifying the claim above broke it twice, and both had been shipping silently:

- **The menu was built once at launch and never again.** Adding a preset would
  not appear until the app restarted. `reloadEverything()` now resets the flag
  so every reload rebuilds the menu from the page.
- **Live reload served stale JavaScript.** Reloading `index.html` is not
  enough — WebKit keeps `app.js` and `styles.css` in its cache and hands back
  the old copies. Editing `app.js` appeared to reload while still running the
  previous code. `load()` now clears the disk and memory caches first.

Confirmed end to end: adding a fifth framing to `VIEWS` made the log report
`built: 5 views` within two seconds, and a sixth made it six, with no Swift
change.

### Menu bar

The 🪐 menu is built from whatever `app.js` reports — framings, speeds and Zen
modes are read from the page rather than duplicated here, so adding a preset to
`VIEWS` makes it appear in the menu with no Swift change.

Live painted frame rate and simulation date · Framing · Speed · Pause · Today ·
Earth Focus · Earth Light · Zen · Labels · Orbit Paths · Show Controls · Copy
Camera Preset · Reload · Open Web Folder · Open Log · Quit.

Every command broadcasts to all displays, so the screens stay in step.

Two things the menu handles that the page cannot do on the desktop:

- **Copy Camera Preset.** The page's `C` shortcut writes to the clipboard,
  which a background WebView is not allowed to do. The host fetches the line
  via `presetLine()` and puts it on the pasteboard itself.
- **Show Controls** toggles `body[data-mode="wallpaper"]`. Note the controls
  become *visible* but still not clickable — the window ignores mouse events by
  design. Making them usable is the Studio window, milestone 4.

## Changes made to the web repo

Tagged `web-v1` immediately before, so `git diff web-v1` shows exactly this.
All of it is inert in an ordinary browser tab, verified by loading the page
both ways: without the flag the page still reports 30 fps, auto-Zen on, and all
chrome visible, with no console errors.

- `app.js` — a `host` config block reading `window.__WALLPAPER__` or
  `?mode=wallpaper`; adaptive frame-rate cap; auto-Zen made conditional; a
  painted-frame counter; and `window.WallpaperBridge`.
- `styles.css` — a `body[data-mode="wallpaper"]` block hiding chrome.

## Findings

### App Nap silently kills the app

A `LSUIElement` app whose only windows are on the desktop layer is a prime App
Nap target. When napped, timers coalesce away and the WebViews never finish
loading — **no error, no failed navigation, nothing logged.** Fixed with
`ProcessInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep)`,
which still lets the Mac itself sleep.

A 6-second load watchdog logs an explicit diagnostic if `index.html` has not
loaded, so this class of silent failure names itself.

### Measure painted frames, not rAF ticks

`app.js` has always rate-capped its render loop (line ~1494). Counting
`requestAnimationFrame` callbacks therefore measures the display refresh rate,
not the work being done — an early measurement of "50 fps" was really 50 rAF
ticks wrapping a 30 fps cap. `WallpaperBridge.stats()` returns frames actually
painted.

### Cost is draw-call count, not fill rate

The host app uses **0.4% CPU / 23 MB**; the WebContent processes running all
the astronomy are **1.6% each**. Essentially everything lands in the single
shared `com.apple.WebKit.GPU` process. Measured on two displays:

| Target fps | Render scale | Painted | GPU process |
| --- | --- | --- | --- |
| 20 | 1.0 | 12 | 100% — saturated |
| 20 | 0.75 | 13.5 | 89% |
| 20 | 0.6 | 14 | 80% |
| 12 | 1.0 | 10 | 75% |
| 8 | 1.0 | 7.5 | 50% |
| 5 | 1.0 | 5 | 47% |
| 3 | 1.0 | 3 | 43% |

**Treat the GPU column as indicative, not precise.** `ps %cpu` reports an
average over the process lifetime rather than an instantaneous sample, and
these were taken on a machine simultaneously running the tooling that measured
them. A later reading of the 10 fps default showed the GPU process closer to
95%, well above what the table suggests. The *shape* of the result — resolution
barely matters, there is a floor, there is a cliff — held up across every run.
The absolute numbers did not.

Note also that WindowServer independently sat around 30% compositing two
full-screen desktop layers, which is outside the WebKit figure entirely.

Two conclusions:

- **Cutting resolution barely helps.** 40% fewer pixels bought 2 fps, so the
  bottleneck is the number of draw operations — roughly 30 stroked arcs per
  orbit across eight orbits, plus belt debris and offscreen sphere buffers,
  all rebuilt per frame — not pixel fill.
- **There is a fixed floor around 43%** that no frame rate reaches below, and a
  saturation cliff above ~20 fps where output collapses rather than degrading.
  The usable band is roughly 8–12 fps, and 8 is where the target is actually
  met.

Defaults are therefore **10 fps idle at full render scale**, rising to 20 when
time is accelerated or you interact. At real-time speed the scene is nearly
static, so the low idle rate is not visible.

### The scene cache (milestone 8) — done

Acting on the conclusion above: the scene is painted into an offscreen canvas
and reused while nothing changes. Crucially a frame with a fresh cache does
**no work at all** rather than blitting — a canvas keeps its contents between
frames, so the correct amount of work is none.

Measured on two displays at 10 fps, DPR 1.0:

| `sceneInterval` | Real paints/s | WebKit GPU | WindowServer |
| --- | --- | --- | --- |
| 0 (off) | 9 | 64.7% | 46.7% |
| 300 ms | 3.5 | 32.2% | 42.2% |
| **500 ms (default)** | **2.0** | **29.7%** | 35.8% |
| 1000 ms | 1.0 | 20.1% | 41.3% |

**GPU process cost roughly halved** — 64.7% → 29.7%. An intermediate version
that still blitted the buffer every frame only reached 43.5%, so skipping the
frame entirely is where most of the remaining win came from.

Correctness was checked in a browser by driving the bridge directly, not by
eye: the canvas bitmap verifiably changes on `setView`, idle sits at ~1.5
repaints/s, and fast-forwarding at 30 days per second climbs to ~19.5
repaints/s. The cache gets out of the way exactly when it should.

`sceneInterval` is a staleness ceiling, and exists only so the Sun's shimmer
and the star twinkle keep moving. Beyond 500 ms they start to look steppy,
which is why the default is not higher despite 1000 ms being cheaper.

### Occlusion detection does not work

`NSWindow.occlusionState` reported `.visible` continuously, including with
ordinary windows covering the desktop, so "pause when covered" cannot be built
on it. Not yet tested against a genuinely full-screen app. Fallback for
milestone 6 is polling `CGWindowListCopyWindowInfo`.

### The launch hang was `getxattr`, not App Nap

Launches were failing regularly: the app running at 0.2% CPU, no window, no
timers, no WebKit callbacks, and nothing in the log after `[screens]`. It
looked exactly like App Nap, which is why it was first misdiagnosed as that.

`sample` on a stuck process showed the real cause — the main thread parked in:

```
AppDelegate.sourceSignature()
  → FileManager.attributesOfItem(atPath:)
    → _FileManagerImpl._extendedAttributes
      → getxattr        ← blocked indefinitely
```

`attributesOfItem` fetches extended attributes as well as the stat fields, and
`getxattr` can block on a cloud-synced folder waiting for the file provider.
`~/Documents` frequently is one. Because this ran on the main thread during
`applicationDidFinishLaunching`, everything downstream was stuck behind it.

Two changes:

- `sourceSignature()` uses a bare `stat(2)`, which never touches xattrs.
- The watcher runs on its own `DispatchSourceTimer` on a utility queue and only
  hops to the main thread when a file has actually changed, so no filesystem
  stall can ever reach the UI again.

12 of the last 13 launches came up clean, against near-consistent failure
before. If it ever recurs the load watchdog names it in the log.

**The lesson generalises:** never call `FileManager.attributesOfItem` on the
main thread against a path you do not control. Prefer `stat` or
`URL.resourceValues` with explicit keys.

## Remaining milestones

4. ~~Studio window~~ — done
5. ~~`WallpaperBridge`~~ — done
6. ~~Energy gating~~ — done
7. **Preset browser** with JSON persistence in Application Support
8. ~~Renderer caching~~ — done

## Layout

```
live-macos-wallpaper/
  index.html  app.js  styles.css  assets/   the web app, unchanged
  macos/
    Sources/
      main.swift              entry point, accessory activation policy
      AppDelegate.swift       surfaces, menu, idle, energy gating, live reload
      WallpaperWindow.swift   borderless desktop-level NSWindow
      WallpaperSurface.swift  window + WKWebView + bootstrap + bridge
      StudioWindowController.swift   the interactive composing window
      Occlusion.swift         window-list coverage sampling
      Log.swift               stdout and ~/Library/Logs/SolarWallpaper.log
    Resources/Info.plist      LSUIElement bundle metadata
    build.sh                  universal build, bundle assembly, install
```
