# Live Watercolor Solar System

A self-contained animated HTML wallpaper inspired by soft Japanese stationery and children's storybook watercolor art.

## Open it

On macOS, double-click **Start Wallpaper.command**. It opens the wallpaper in your default browser. You can also double-click `index.html` directly.

For the cleanest wallpaper-like view, enter full screen in the browser (`Control` + `Command` + `F`).

## Aiming the camera

Drag on the page to fly the camera and find an angle by eye. A readout appears in the corner showing every parameter live.

| Gesture | Axis |
| --- | --- |
| Drag ↔ | Azimuth — yaw around the ecliptic pole |
| Drag ↕ | Elevation — pitch above (or below) the ecliptic plane |
| Shift-drag ↔ | Roll — rotation about the view axis |
| ⌘-drag (or right-drag) | Slide the Sun's anchor around the frame |
| Scroll | Zoom |
| Alt-scroll | Dolly the viewer in and out. Past 22 it hands back to orthographic |
| `-` / `=` | Planet and Sun size |
| Arrow keys | Nudge azimuth and elevation by 2°, or 0.5° with Shift |

Those three rotations are a complete 3D orientation — there is no fourth angle to find.

When you land on something you like, press `C`. It copies the current camera as a ready-made line for the `VIEWS` array in `app.js`, so you can paste it in and keep it. `R` discards your changes and returns to the preset; `V` cycles presets; `K` shows or hides the readout.

## Controls

- `K` — show/hide the camera readout
- `C` — copy the current camera as a preset
- `R` — reset to the current preset
- `V` — cycle the framing: **illustration** (perspective camera low over the plane), **wide** (whole system, 27° tilt), **close** (16° tilt, Sun off to the right), **tabletop** (62°, almost straight down)
- `L` — toggle planet labels
- `O` — toggle orbit paths and the tiny illustrated asteroid belt
- `Space` — pause/resume simulation time, planet rotation, and twinkling
- `[` / `]` — step through the five simulation speeds
- `T` — return to the real current date and real-time speed
- `P` — show/hide the compact planet-position panel
- `E` — toggle Earth Focus
- `S` — cycle Earth Focus lighting: accurate, eclipse demo, or off
- `Z` — enter the selected Zen mode; press repeatedly to cycle all three
- `Escape` or any other interaction — leave Zen mode and return to today
- `H` — show/hide the help card

## Time travel

The bottom control bar drives the astronomical date used by the whole scene. Run time forward or backward, pause it, or choose **real time**, **1 hour per second**, **1 day per second**, **30 days per second**, or **1 year per second**. The calendar and signed day counter remain synchronized with the rendered ephemerides, and **Today** returns to the live Solar System.

The compact position panel reports each planet's J2000 heliocentric ecliptic longitude and current distance from the Sun in astronomical units (AU) for the displayed date.

## Idle desktop / Zen modes

Choose a mode in the bottom bar and press **Zen**, or press `Z`. With no interaction, the selected mode also begins automatically after 45 seconds. Pointer movement, scrolling, clicking, or a non-`Z` key restores the saved camera and returns the calendar to today. Automatic Zen is disabled when the system reduced-motion preference is active.

- **Astronomical Zen** advances one shared, physically consistent simulation calendar by six hours per real second. Planet positions and axial rotation remain tied to Astronomy Engine.
- **Ambient Zen** keeps the Solar System at the current date while the camera breathes and the painted planet textures turn at calm presentation speeds.
- **Dream Zen** moves every planet independently along its sampled real ephemeris path, giving the outer planets visible motion without claiming that all positions belong to one calendar date.

All modes add separate, very slow oscillations to elevation, azimuth, roll, zoom, and the Sun anchor, and render at a calmer 24 frames per second.

## Earth Focus

Press **Earth focus** in the bottom bar or `E` to replace the full Solar System with a close, centered Earth and its Moon. This scene omits the Sun, every other planet, the asteroid belt, and every planetary orbit. One watercolor guide remains: the Moon's real sampled geocentric orbit, enlarged with the Moon for readability. `O` toggles it. Toggling Earth Focus off restores the previous full-system camera without changing the preset.

Earth Focus has its own default camera: elevation `50.4°`, azimuth `45.0°`, roll `339.9°`, zoom `0.96×`, distance `2.30`, body scale `0.86×`, and Sun anchor `0.60, 0.50`. Entering it starts from this composition; leaving it restores the separate Solar System camera.

Earth Focus works with every Zen mode. **Astronomical Zen** advances the real Earth–Moon ephemeris, while **Ambient Zen** keeps the real current Earth orientation and Moon direction under the breathing camera. **Dream Zen** provides a deliberately cinematic Moon orbit and axial motion.

The Earth-only **Light** menu defaults to **Accurate**. It paints the dated day/night terminator on Earth, the Moon's phase, and real umbra/penumbra shadows whenever the date actually produces a solar or lunar eclipse. The Moon-orbit guide fades on its far side to make depth easier to read. **Eclipse demo** temporarily places the Moon into a slowly sweeping solar-eclipse alignment so the same cone geometry can be inspected without hunting for an eclipse date; its real orbit guide is hidden while the demonstration is active. **Off** restores an unshaded study view. None of this lighting UI or shadow work runs outside Earth Focus, and the canvas adds no lighting or eclipse annotations.

Outside Dream Zen, Earth Focus derives the camera-facing terrestrial longitude from Astronomy Engine's prime-meridian phase, so the appropriate continent faces the external camera for the displayed date. The Moon likewise uses its exact geocentric direction and rotational orientation. The watercolor maps are artistic rather than survey products, and the displayed Earth/Moon sizes and separation remain deliberately enlarged.

## What is live

- Planet centers are recalculated from the displayed simulation date using Astronomy Engine's heliocentric ephemerides.
- The Moon uses its current geocentric direction and a deliberately enlarged illustrated orbit so it remains readable beside Earth.
- Orbit rings are traced by sampling each planet's real ephemeris across one full period, not by drawing a fitted ellipse.
- Coordinates are rotated into the J2000 ecliptic frame, then projected one of two ways. Presets without a `distance` use **orthographic** projection: a viewing direction plus a tilt, no viewer position, so every orbit ring stays symmetric about the Sun. Presets with a `distance` use a **perspective** camera standing that far out, which makes the near half of each ring spread wide and the far half bunch toward a horizon. The bearing is fixed either way, so the composition never drifts.
- Orbital distances are deliberately compressed so Earth remains readable on a laptop screen. Planet sizes are illustrative, not to scale.
- Each orbit is emitted as ~30 short painted arcs, each carrying its own depth. Arcs, debris, planets, the Moon and the Sun are sorted together and drawn back to front, so rear strokes disappear behind a body while forward strokes remain visible over it. The far half of every ring is also faded. Those two things together make the rings read as a plane rather than flat nested ovals.
- The Sun uses its own seamless watercolor surface map, a restrained bloom and loose painted contour marks. Its depth participates in the same sort as the orbit arcs, so paths crossing near it retain correct front/back visibility.
- Outside Earth Focus, planet lighting is intentionally shallow and low-contrast. Texture, paper grain and painted clouds carry the form, keeping the bodies visually integrated with the illustrated background rather than reading as glossy 3D objects.
- Each spherical texture is assembled in a high-resolution offscreen buffer and then rotated as one completed disc, preventing the longitude-slice seams that otherwise appear as stripes on large, pale bodies such as the Moon.
- Planet spin axes and rotational phases come from Astronomy Engine for the displayed simulation date and are projected through the live camera. Venus and Uranus rotate retrograde, Uranus appears on its side, and Saturn's rings follow Saturn's real equatorial plane instead of a fixed screen angle.
- Orbital motion and axial rotation stay tied to the simulation calendar, including reverse time and every accelerated speed. Only Sun shimmer and star twinkling are artistically accelerated.

No internet connection, account, build step, backend, or hosting is required.

## macOS live wallpaper note

This folder is the web version. To place it behind desktop icons, use any macOS utility that can display a local webpage as the desktop and point it at `index.html`. The page is responsive and has no server dependency.

A dedicated native host lives alongside this page in [`macos/`](macos/). On a development machine it loads this folder in place rather than copying it, so editing `app.js` updates the live desktop within a couple of seconds. The web version below is unaffected by its presence and still runs standalone with no build step.

Prebuilt universal `.dmg` files are on the [releases page](https://github.com/Ducvuuu/live-macos-wallpaper/releases). Those bundles carry their own copy of this page, so they need no checkout. macOS 13 or later. The build is ad-hoc signed rather than notarized, so the first launch is refused and has to be allowed under **System Settings → Privacy & Security → Open Anyway**.

## Wallpaper mode

Add `?mode=wallpaper` to the URL — or set `window.__WALLPAPER__` before `app.js` runs, which is what the native host does — to switch the page into desktop behaviour. Nothing below applies to an ordinary tab.

| Setting | Tab default | Wallpaper default | Meaning |
| --- | --- | --- | --- |
| `fps` | 30 | 10 | Frame rate while time runs in real time |
| `activeFps` | 30 | 20 | Frame rate when time is accelerated or you are interacting |
| `zenFps` | 24 | 20 | Frame rate in Zen |
| `sceneInterval` | 0 (off) | 500 | Milliseconds a cached scene may be reused |
| `autoZen` | on | **off** | Whether 45 seconds of no input starts Zen |

Two things change on the desktop, both for the same reason: the wallpaper window receives no pointer or keyboard events at all.

- **Idle Zen is off** — the page's own timer, at least. With no events arriving it would fire after 45 seconds and never release, running the calendar away from today at six hours per second. A host can still run Zen as a true idle animation by measuring machine idle time itself and calling `setZen()`, which is what the macOS host does.
- **The frame rate is much lower and adaptive.** At real-time speed the scene is very nearly static — only the twinkle and Sun shimmer change — so painting it 30 times a second is almost entirely wasted. Accelerated time and interaction raise it again.

The page's own chrome is hidden via `body[data-mode="wallpaper"]` in `styles.css`.

### The scene cache

At real-time speed the ephemeris refreshes once a minute and the camera is still, so several hundred consecutive frames paint an identical picture — around 240 stroked orbit arcs, the belt debris, eight textured spheres, the rings and the Moon, all rebuilt from scratch each time.

With `sceneInterval` above zero the whole scene is painted into an offscreen canvas and reused. A frame where nothing has changed and the cache is still fresh does **no work at all** — no clear, no blit, no draw calls — because a canvas keeps its contents between frames.

Invalidation compares a signature of everything the scene depends on (ephemeris timestamp, every camera field, labels, orbits, Zen mode, size) rather than relying on call sites remembering to mark it dirty. A missed invalidation would present as a wallpaper that silently stops updating, which is exactly the bug you would not notice.

The cache gets out of the way when it should: fast-forwarding at 30 days per second measured ~19 repaints per second, while sitting at real time measured ~2. Earth Focus is never cached — it is a two-body scene and far cheaper already.

`sceneInterval` is the ceiling on staleness, and it exists only so the Sun's shimmer and the star twinkle keep moving. Longer means cheaper and steppier.

## WallpaperBridge

Because the desktop window cannot be clicked or typed into, wallpaper mode exposes `window.WallpaperBridge` so a host application can reach everything the control bar and keyboard shortcuts do. It is present in a tab too, which makes it a convenient console API.

```js
WallpaperBridge.stats()          // frames painted since last call, date, view, speed, …
WallpaperBridge.views()          // the VIEWS array, as {index, name}
WallpaperBridge.setView(2)       // and cycleView(), resetView(), presetLine()
WallpaperBridge.setSpeed(0)      // setDirection(), togglePause(), today()
WallpaperBridge.setEarthFocus(true)
WallpaperBridge.setEarthLighting("accurate")
WallpaperBridge.setZen("ambient")   // null to leave Zen
WallpaperBridge.setLabels(true)     // setOrbits(), setChrome()

WallpaperBridge.setRendering(false) // stop painting entirely; true resumes

WallpaperBridge.snapshot()          // the whole composition, as plain data
WallpaperBridge.apply(snapshot)     // put that composition back
```

`snapshot()` and `apply()` are how a composition moves between windows. Both camera objects are captured, not just the active one, so switching Earth Focus on and off does not lose the other framing. Zen is deliberately excluded — it is a presentation state, not part of a composition.

`setRendering(false)` is for when nothing can see the page — covered, locked or asleep. The animation loop keeps ticking so it can resume instantly, but does no work. Resuming forces a fresh ephemeris and a full repaint, since arbitrary time may have passed.

`stats()` reports **frames actually painted**, resetting the counter on each call. Counting `requestAnimationFrame` ticks instead would report the display refresh rate and tell you nothing, because the render loop is rate-capped and returns early.

## Changing the framing

Edit the `VIEWS` array at the top of `app.js`. Each preset is five numbers:

| Field | Effect |
| --- | --- |
| `elevation` | Degrees above the ecliptic. 0 is edge-on, 90 is straight down. Low values flatten the orbits into near-lines; high values open them into circles. |
| `azimuth` | Which compass bearing to look from. Rotates the whole system in place. |
| `sunX`, `sunY` | Where the Sun sits, as a fraction of the viewport. `0.5, 0.5` centres it. |
| `roll` | Degrees to rotate the finished projection about the Sun. Positive tips the plane down to the right. A plane square to the frame is the strongest tell that an image was generated rather than composed. |
| `zoom` | `1` fits Neptune's ring in frame. Above `1` crops the outer rings off the edges. |
| `bodies` | Planet and Sun size multiplier. |
| `distance` | Omit for orthographic. Include it to place a real viewer that far from the Sun, in units where Neptune's compressed ring is `1`. Smaller values exaggerate the perspective; below about `1.2` the near orbits start to swing past the camera. |

Add as many presets as you like — `V` cycles through all of them.

## License

This project is MIT licensed — see [LICENSE](LICENSE).

Astronomical calculations use Astronomy Engine 2.1.19, included locally under its MIT license. Third-party notices are in [LICENSES.md](LICENSES.md).
