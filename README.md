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
- `Space` — pause/resume planet rotation and twinkling
- `H` — show/hide the help card

## What is live

- Planet centers are recalculated from the current date and time using Astronomy Engine's heliocentric ephemerides.
- The Moon uses its current geocentric direction and a deliberately enlarged illustrated orbit so it remains readable beside Earth.
- Orbit rings are traced by sampling each planet's real ephemeris across one full period, not by drawing a fitted ellipse.
- Coordinates are rotated into the J2000 ecliptic frame, then projected one of two ways. Presets without a `distance` use **orthographic** projection: a viewing direction plus a tilt, no viewer position, so every orbit ring stays symmetric about the Sun. Presets with a `distance` use a **perspective** camera standing that far out, which makes the near half of each ring spread wide and the far half bunch toward a horizon. The bearing is fixed either way, so the composition never drifts.
- Orbital distances are deliberately compressed so Earth remains readable on a laptop screen. Planet sizes are illustrative, not to scale.
- Each orbit is emitted as ~30 short painted arcs, each carrying its own depth. Arcs, debris, planets, the Moon and the Sun are sorted together and drawn back to front, so rear strokes disappear behind a body while forward strokes remain visible over it. The far half of every ring is also faded. Those two things together make the rings read as a plane rather than flat nested ovals.
- The Sun uses its own seamless watercolor surface map, a restrained bloom and loose painted contour marks. Its depth participates in the same sort as the orbit arcs, so paths crossing near it retain correct front/back visibility.
- Planet lighting is intentionally shallow and low-contrast. Texture, paper grain and painted clouds carry the form, keeping the bodies visually integrated with the illustrated background rather than reading as glossy 3D objects.
- Orbital motion stays tied to real time. Only axial texture rotation, Sun shimmer, and star twinkling are artistically accelerated.

No internet connection, account, build step, backend, or hosting is required.

## macOS live wallpaper note

This folder is the web version. To place it behind desktop icons, use any macOS utility that can display a local webpage as the desktop and point it at `index.html`. The page is responsive and has no server dependency.

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

Astronomical calculations use Astronomy Engine 2.1.19, included locally under its MIT license.
