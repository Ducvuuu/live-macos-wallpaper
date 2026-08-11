(() => {
  "use strict";

  const canvas = document.querySelector("#scene");
  const ctx = canvas.getContext("2d", { alpha: true });
  const loading = document.querySelector("#loading");
  const status = document.querySelector("#status");
  const help = document.querySelector("#help");
  const camera = document.querySelector("#camera");

  const DEG = Math.PI / 180;
  const DAY = 86400000;
  // Framing presets. The projection is orthographic, so these are pure
  // composition: how far to tilt above the ecliptic, which bearing to look
  // from, where the Sun sits in frame, how far to zoom, how big to draw bodies.
  //   elevation — 0 is edge-on, 90 is straight down onto the ecliptic
  //   azimuth   — compass bearing, fixed so the composition never drifts
  //   sunX/sunY — Sun's anchor as a fraction of the viewport
  //   zoom      — 1 fits Neptune's ring in frame; above 1 crops the outer rings
  //   bodies    — planet and Sun size multiplier
  //   roll      — degrees to rotate the finished projection about the Sun.
  //               Positive tips the plane down to the right. Nothing in an
  //               illustration is ever square to the canvas.
  //   distance  — omit for orthographic (rings stay symmetric about the Sun).
  //               Set it to place a real viewer that far out, in units where
  //               Neptune's compressed ring is 1. Smaller means stronger
  //               perspective: near arcs spread wide, far arcs bunch up.
  const VIEWS = [
    { name: "Illustration", elevation: 8.6, azimuth: 13.9, roll: 21.1, sunX: 0.604, sunY: 0.502, zoom: 1.742, bodies: 0.86, distance: 2.3 },
    { name: "Wide",     elevation: 27, azimuth: 300, sunX: 0.53, sunY: 0.47, zoom: 1.00, bodies: 0.62 },
    { name: "Close",    elevation: 16, azimuth: 300, sunX: 0.78, sunY: 0.54, zoom: 2.35, bodies: 1.15 },
    { name: "Tabletop", elevation: 62, azimuth: 300, sunX: 0.50, sunY: 0.50, zoom: 1.00, bodies: 0.55 }
  ];
  const textureRoot = "assets/textures/";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const planets = [
    { name: "Mercury", radius: 10, period: 87.969, spin: 230, color: "#d8c5ad" },
    { name: "Venus",   radius: 17, period: 224.701, spin: -290, color: "#e4af72" },
    { name: "Earth",   radius: 22, period: 365.256, spin: 160, color: "#8eb2be" },
    { name: "Mars",    radius: 15, period: 686.980, spin: 190, color: "#c97958" },
    { name: "Jupiter", radius: 42, period: 4332.59, spin: 250, color: "#cda17f" },
    { name: "Saturn",  radius: 34, period: 10759.2, spin: 280, color: "#d7bc8e", rings: true },
    { name: "Uranus",  radius: 25, period: 30688.5, spin: -320, color: "#9bc5c3" },
    { name: "Neptune", radius: 25, period: 60182, spin: 300, color: "#718cae" }
  ];

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    images: new Map(),
    vectors: new Map(),
    orbitVectors: new Map(),
    cameraAxis: { x: 1, y: 0 },
    basis: null,
    viewIndex: 0,
    labels: false,
    orbits: true,
    paused: reducedMotion,
    startTime: performance.now(),
    pausedAt: 0,
    frozenElapsed: 0,
    lastEphemeris: 0,
    lastFrame: 0
  };

  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const wrap = degrees => ((degrees % 360) + 360) % 360;

  // The live camera is a mutable copy of a preset, so dragging never damages
  // the presets themselves — cycling with V always restores clean values.
  function view() {
    return state.live;
  }

  function applyView(index = state.viewIndex) {
    state.viewIndex = index;
    state.live = Object.assign({}, VIEWS[index]);
    refreshCamera();
  }

  function refreshCamera() {
    state.basis = cameraBasis();
    const roll = (view().roll || 0) * DEG;
    state.roll = roll ? { cos: Math.cos(roll), sin: Math.sin(roll) } : null;
    const azimuth = view().azimuth * DEG;
    state.cameraAxis = { x: Math.cos(azimuth), y: Math.sin(azimuth) };
    describeView();
    updateReadout();
  }

  function markCustom() {
    view().name = "Custom";
  }

  function describeView() {
    if (!state.ephemerisDate) return;
    const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
      .format(state.ephemerisDate);
    status.textContent = `Live positions · ${stamp} · ${view().name.toLowerCase()} view, ${Math.round(view().elevation)}° above ecliptic`;
  }

  function updateReadout() {
    if (!camera || camera.hidden) return;
    const v = view();
    camera.textContent = [
      `elevation  ${v.elevation.toFixed(1)}°   drag ↕`,
      `azimuth    ${v.azimuth.toFixed(1)}°   drag ↔`,
      `roll       ${(v.roll || 0).toFixed(1)}°   shift-drag ↔`,
      `zoom       ${v.zoom.toFixed(2)}×   scroll`,
      `distance   ${v.distance ? v.distance.toFixed(2) : "∞ (orthographic)"}   alt-scroll`,
      `bodies     ${v.bodies.toFixed(2)}×   - / =`,
      `sun anchor ${v.sunX.toFixed(2)}, ${v.sunY.toFixed(2)}   ⌘-drag`,
      ``,
      `C copies this as a preset`
    ].join("\n");
  }

  function presetLine() {
    const v = view();
    const fields = [
      `name: "Custom"`,
      `elevation: ${+v.elevation.toFixed(1)}`,
      `azimuth: ${+v.azimuth.toFixed(1)}`,
      `roll: ${+(v.roll || 0).toFixed(1)}`,
      `sunX: ${+v.sunX.toFixed(3)}`,
      `sunY: ${+v.sunY.toFixed(3)}`,
      `zoom: ${+v.zoom.toFixed(3)}`,
      `bodies: ${+v.bodies.toFixed(2)}`
    ];
    if (v.distance) fields.push(`distance: ${+v.distance.toFixed(2)}`);
    return `{ ${fields.join(", ")} },`;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = file;
    });
  }

  // Painted stand-in so one missing or truncated texture cannot blank the scene.
  function fallbackTexture(color) {
    const tile = document.createElement("canvas");
    tile.width = 256;
    tile.height = 128;
    const tctx = tile.getContext("2d");
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, tile.width, tile.height);
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * tile.height;
      tctx.fillStyle = `rgba(255, 255, 255, ${0.03 + 0.05 * Math.abs(Math.sin(i * 1.7))})`;
      tctx.fillRect(0, y, tile.width, tile.height / 26);
    }
    return tile;
  }

  async function loadAssets() {
    const jobs = [
      ...planets.map(planet => ({ key: planet.name, file: `${planet.name.toLowerCase()}.webp`, color: planet.color })),
      { key: "Sun", file: "sun.webp", color: "#f2b156" }
    ];
    const missing = [];
    await Promise.all(jobs.map(async job => {
      try {
        state.images.set(job.key, await loadImage(`${textureRoot}${job.file}`));
      } catch {
        state.images.set(job.key, fallbackTexture(job.color));
        missing.push(job.file);
      }
    }));
    if (missing.length) console.warn(`Using painted stand-ins for: ${missing.join(", ")}`);
  }

  function resize() {
    state.dpr = Math.min(devicePixelRatio || 1, 2);
    state.width = innerWidth;
    state.height = innerHeight;
    canvas.width = Math.round(innerWidth * state.dpr);
    canvas.height = Math.round(innerHeight * state.dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function eclipticVector(body, date) {
    const eqj = Astronomy.HelioVector(Astronomy.Body[body], date);
    return Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), eqj);
  }

  function updateEphemeris(date = new Date()) {
    for (const planet of planets) state.vectors.set(planet.name, eclipticVector(planet.name, date));

    if (!state.orbitVectors.size) {
      for (const planet of planets) {
        const points = [];
        const samples = planet.name === "Neptune" ? 120 : 150;
        for (let i = 0; i <= samples; i++) {
          const offset = (i / samples - 0.5) * planet.period * DAY;
          points.push(eclipticVector(planet.name, new Date(date.getTime() + offset)));
        }
        state.orbitVectors.set(planet.name, points);
      }
    }
    state.lastEphemeris = Date.now();
    state.ephemerisDate = date;
    describeView();
  }

  function compressed(vector) {
    const radius = Math.hypot(vector.x, vector.y, vector.z) || 1;
    const displayRadius = Math.pow(Math.min(radius, 35) / 30.1, 0.28);
    const factor = displayRadius / radius;
    return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
  }

  function viewScale() {
    // At zoom 1 the widest ring must fit the frame in both axes. Vertically the
    // ellipse is foreshortened by sin(elevation), so height rarely binds at a
    // low tilt and almost always binds at a steep one.
    const v = view();
    const elevation = v.elevation * DEG;
    const margin = 0.94;
    const fit = Math.min(
      state.width * 0.46 * margin,
      (state.height * 0.46 * margin) / Math.max(Math.sin(elevation), 0.2)
    );
    return fit * v.zoom;
  }

  // Camera basis for the current view. `toward` points from the Sun out to the
  // viewer; `right` and `up` span the screen plane.
  function cameraBasis() {
    const v = view();
    const el = v.elevation * DEG;
    const az = v.azimuth * DEG;
    return {
      toward: { x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) },
      right: { x: -Math.sin(az), y: Math.cos(az), z: 0 },
      up: { x: -Math.sin(el) * Math.cos(az), y: -Math.sin(el) * Math.sin(az), z: Math.cos(el) }
    };
  }

  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

  // Roll is a plain 2D rotation of the finished projection about the Sun, so it
  // applies identically to rings, planets and debris and costs nothing.
  function rolled(x, y) {
    const r = state.roll;
    if (!r) return { x, y };
    const cx = state.width * view().sunX;
    const cy = state.height * view().sunY;
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: cx + dx * r.cos - dy * r.sin,
      y: cy + dx * r.sin + dy * r.cos
    };
  }

  function project(vector) {
    const v = view();
    const p = compressed(vector);
    const basis = state.basis;
    const scale = viewScale();

    // Orthographic: no viewer position at all, so every ring stays symmetric
    // about the Sun. Cheaper, and right for the map-like framings.
    if (!v.distance) {
      const flat = rolled(
        state.width * v.sunX + dot(p, basis.right) * scale,
        state.height * v.sunY - dot(p, basis.up) * scale
      );
      return { x: flat.x, y: flat.y, depth: -dot(p, basis.toward), size: 1 };
    }

    // Perspective: a real viewer standing `distance` out from the Sun, in units
    // where Neptune's compressed ring is 1. Near arcs spread, far arcs bunch
    // toward a horizon — the asymmetry orthographic can never produce.
    const d = Math.max(v.distance, 1.15);
    const rel = {
      x: p.x - basis.toward.x * d,
      y: p.y - basis.toward.y * d,
      z: p.z - basis.toward.z * d
    };
    const depth = -dot(rel, basis.toward);       // distance in front of the viewer
    const focal = scale * d;                     // matches ortho scale at the Sun
    const near = Math.max(depth, 0.05);
    const flat = rolled(
      state.width * v.sunX + (dot(rel, basis.right) / near) * focal,
      state.height * v.sunY - (dot(rel, basis.up) / near) * focal
    );
    return {
      x: flat.x,
      y: flat.y,
      depth,
      size: Math.min(Math.max(d / near, 0.5), 2.4)
    };
  }

  const CHUNK = 5;   // samples per independently sorted arc segment

  function strokeArc(slice, alpha) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(slice[0].x, slice[0].y);
    for (let i = 1; i < slice.length; i++) ctx.lineTo(slice[i].x, slice[i].y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Soft wash underneath, then a crisp hairline: reads as ink on damp paper.
    ctx.strokeStyle = `rgba(236, 178, 116, ${0.09 * alpha})`;
    ctx.lineWidth = 3.4;
    ctx.stroke();

    ctx.strokeStyle = `rgba(247, 209, 156, ${0.52 * alpha})`;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
  }

  // An orbit is emitted as many short arcs, each carrying its own depth, so the
  // sort can thread them through the planets. The far half is also faded — that
  // pairing is what makes the rings read as a plane instead of flat ovals.
  function collectOrbit(points, base, out) {
    const projected = points.map(project);
    let nearest = Infinity;
    let farthest = -Infinity;
    for (const p of projected) {
      if (p.depth < nearest) nearest = p.depth;
      if (p.depth > farthest) farthest = p.depth;
    }
    const span = (farthest - nearest) || 1;

    for (let i = 0; i < projected.length - 1; i += CHUNK) {
      const slice = projected.slice(i, Math.min(i + CHUNK + 1, projected.length));
      let sum = 0;
      for (const p of slice) sum += p.depth;
      const depth = sum / slice.length;
      const away = (depth - nearest) / span;             // 0 nearest, 1 farthest
      const alpha = base * (1 - away * 0.62);
      out.push({ depth, draw: () => strokeArc(slice, alpha) });
    }
  }

  function collectAsteroidBelt(out) {
    for (let i = 0; i < 46; i++) {
      const angle = i * 2.399963 + Math.sin(i * 8.17) * 0.05;
      const radius = 2.72 + Math.sin(i * 3.1) * 0.16;
      const p = project({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: Math.sin(i * 1.7) * 0.025 });
      out.push({
        depth: p.depth,
        draw: () => {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(angle);
          ctx.fillStyle = `rgba(230, 183, 126, ${0.30 * Math.min(p.size, 1.6)})`;
          if (i % 5 === 0) ctx.fillRect(-2.1, -0.7, 4.2, 1.4);
          else {
            ctx.beginPath();
            ctx.arc(0, 0, i % 3 ? 0.8 : 1.25, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      });
    }
  }

  function drawSun(elapsed) {
    const v = view();
    const x = state.width * v.sunX;
    const y = state.height * v.sunY;
    const responsive = Math.max(0.72, Math.min(1.25, Math.min(state.width, state.height) / 820));
    const radius = 66 * responsive * v.bodies * 1.35;
    const pulse = state.paused ? 1 : 1 + Math.sin(elapsed / 2100) * 0.018;

    // The Sun is a light source, not an object: no sphere shader, no surface
    // texture, no hard circumference. Three nested falloffs, drawn after the
    // orbits so the bloom washes over the rings passing near it — that bleed is
    // the main cue for which body emits and which merely reflect.
    const r = radius * pulse;
    ctx.save();
    ctx.globalCompositeOperation = "screen";

    const spread = ctx.createRadialGradient(x, y, r * .8, x, y, r * 3.0);
    spread.addColorStop(0, "rgba(255, 186, 110, .16)");
    spread.addColorStop(.45, "rgba(243, 158, 84, .07)");
    spread.addColorStop(1, "rgba(230, 134, 66, 0)");
    ctx.fillStyle = spread;
    ctx.fillRect(x - r * 3.0, y - r * 3.0, r * 6.0, r * 6.0);

    const halo = ctx.createRadialGradient(x, y, r * .9, x, y, r * 1.62);
    halo.addColorStop(0, "rgba(255, 212, 146, .62)");
    halo.addColorStop(.38, "rgba(252, 184, 112, .30)");
    halo.addColorStop(1, "rgba(246, 158, 88, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - r * 1.62, y - r * 1.62, r * 3.24, r * 3.24);

    // Core holds near-full opacity most of the way out, then dissolves over the
    // last sliver. That reads as a disc without ever presenting a hard rim.
    const core = ctx.createRadialGradient(x, y, 0, x, y, r * 1.04);
    core.addColorStop(0, "rgba(255, 246, 220, .99)");
    core.addColorStop(.46, "rgba(255, 224, 158, .97)");
    core.addColorStop(.74, "rgba(253, 199, 126, .92)");
    core.addColorStop(.89, "rgba(250, 176, 104, .66)");
    core.addColorStop(.96, "rgba(247, 160, 92, .26)");
    core.addColorStop(1, "rgba(244, 150, 86, 0)");
    ctx.fillStyle = core;
    ctx.fillRect(x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
    ctx.restore();
  }

  // Screen-space unit vector pointing from a body toward the Sun, so every
  // planet is lit from where the Sun actually is rather than a fixed corner.
  function lightDirection(x, y) {
    const v = view();
    const dx = state.width * v.sunX - x;
    const dy = state.height * v.sunY - y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  function drawTexturedSphere(image, x, y, radius, rotation, isSun = false, light = { x: -0.6, y: -0.7 }) {
    const diameter = Math.ceil(radius * 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    for (let column = 0; column < diameter; column++) {
      const nx = (column + .5 - radius) / radius;
      if (Math.abs(nx) > 1) continue;
      const longitude = Math.asin(nx) / Math.PI;
      let u = rotation + longitude + .5;
      u = u - Math.floor(u);
      const sourceX = Math.floor(u * image.width) % image.width;
      ctx.drawImage(image, sourceX, 0, 1, image.height, x - radius + column, y - radius, 1.2, radius * 2);
    }

    if (!isSun) {
      // Terminator: highlight sits on the sun-facing limb, shadow opposite it.
      const shade = ctx.createRadialGradient(
        x + light.x * radius * .52, y + light.y * radius * .52, radius * .06,
        x - light.x * radius * .34, y - light.y * radius * .34, radius * 1.22
      );
      shade.addColorStop(0, "rgba(255, 250, 224, .26)");
      shade.addColorStop(.46, "rgba(29, 40, 59, .04)");
      shade.addColorStop(1, "rgba(10, 17, 32, .66)");
      ctx.fillStyle = shade;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

      // Warm crescent where the surface catches the Sun directly.
      ctx.globalCompositeOperation = "screen";
      const rim = ctx.createRadialGradient(
        x + light.x * radius, y + light.y * radius, radius * .04,
        x + light.x * radius, y + light.y * radius, radius * 1.05
      );
      rim.addColorStop(0, "rgba(255, 230, 180, .50)");
      rim.addColorStop(.45, "rgba(255, 212, 150, .12)");
      rim.addColorStop(1, "rgba(255, 200, 130, 0)");
      ctx.fillStyle = rim;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.globalCompositeOperation = "screen";
      const core = ctx.createRadialGradient(x - radius * .25, y - radius * .3, 0, x, y, radius);
      core.addColorStop(0, "rgba(255,255,225,.32)");
      core.addColorStop(1, "rgba(255,203,120,.04)");
      ctx.fillStyle = core;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    if (!isSun) {
      // Faint halo, brightest on the lit side — sells the body as sitting in
      // the scene rather than pasted on top of it.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const halo = ctx.createRadialGradient(
        x + light.x * radius * .3, y + light.y * radius * .3, radius * .92,
        x, y, radius * 1.5
      );
      halo.addColorStop(0, "rgba(255, 222, 172, .20)");
      halo.addColorStop(1, "rgba(255, 210, 150, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = isSun ? "rgba(255, 228, 168, .55)" : "rgba(248, 226, 194, .28)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, radius - .55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawSaturnRings(x, y, radius, front = false) {
    // The ring plane sits near the ecliptic, so it foreshortens with the view
    // tilt exactly as the orbits do. Floored so it never collapses to a hairline.
    const flatten = Math.max(Math.sin(view().elevation * DEG), 0.14);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((-8 + (view().roll || 0)) * DEG);
    ctx.scale(1, flatten);
    ctx.strokeStyle = front ? "rgba(240, 216, 178, .78)" : "rgba(201, 166, 126, .50)";
    ctx.lineWidth = (front ? 5.5 : 8) / flatten;
    ctx.beginPath();
    if (front) ctx.arc(0, 0, radius * 1.72, 0, Math.PI);
    else ctx.ellipse(0, 0, radius * 1.72, radius * 1.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(252, 238, 207, .55)";
    ctx.lineWidth = 1.4 / flatten;
    ctx.beginPath();
    if (front) ctx.arc(0, 0, radius * 1.95, 0, Math.PI);
    else ctx.ellipse(0, 0, radius * 1.95, radius * 1.95, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLabel(name, x, y, radius) {
    ctx.save();
    ctx.font = '600 10px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(250, 236, 211, .72)";
    ctx.shadowColor = "rgba(3, 8, 18, .9)";
    ctx.shadowBlur = 8;
    ctx.fillText(name, x, y + radius + 17);
    ctx.restore();
  }

  function drawTwinkles(elapsed) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 12; i++) {
      const x = ((i * 0.618033 + .07) % 1) * state.width;
      const y = ((i * 0.381966 + .11) % 1) * state.height;
      const flicker = state.paused ? .3 : .16 + .34 * (0.5 + 0.5 * Math.sin(elapsed / (730 + i * 47) + i));
      ctx.fillStyle = `rgba(255, 232, 193, ${flicker})`;
      ctx.fillRect(x - 2.5, y - .45, 5, .9);
      ctx.fillRect(x - .45, y - 2.5, .9, 5);
    }
    ctx.restore();
  }

  function elapsedTime(now) {
    if (state.paused) return state.frozenElapsed;
    return state.frozenElapsed + (now - state.startTime);
  }

  function render(now) {
    requestAnimationFrame(render);
    if (now - state.lastFrame < 1000 / 30) return;
    state.lastFrame = now;
    if (Date.now() - state.lastEphemeris > 60000) updateEphemeris();

    const elapsed = elapsedTime(now);
    ctx.clearRect(0, 0, state.width, state.height);
    drawTwinkles(elapsed);

    // Rings, debris, planets and the Sun all go into one list and are sorted
    // together, so a near arc can cross in front of an outer planet and a far
    // arc can pass behind an inner one.
    const drawables = [];

    if (state.orbits) {
      for (const planet of planets) {
        collectOrbit(state.orbitVectors.get(planet.name), planet.name === "Earth" ? 1.25 : 1, drawables);
      }
      collectAsteroidBelt(drawables);
    }

    drawables.push({ depth: project({ x: 0, y: 0, z: 0 }).depth, draw: () => drawSun(elapsed) });

    const scale = Math.max(.72, Math.min(1.28, Math.min(state.width, state.height) / 820)) * view().bodies;
    for (const planet of planets) {
      const point = project(state.vectors.get(planet.name));
      let radius = planet.radius * scale * point.size;
      if (planet.name === "Earth") radius *= 1.18;
      if (planet.name === "Jupiter") radius *= .92;
      drawables.push({
        depth: point.depth,
        draw: () => {
          if (planet.rings) drawSaturnRings(point.x, point.y, radius, false);
          const rotation = elapsed / (planet.spin * 1000);
          const light = lightDirection(point.x, point.y);
          drawTexturedSphere(state.images.get(planet.name), point.x, point.y, radius, rotation, false, light);
          if (planet.rings) drawSaturnRings(point.x, point.y, radius, true);
          if (state.labels) drawLabel(planet.name, point.x, point.y, radius);
        }
      });
    }

    // Farthest first, so nearer things paint over them.
    drawables.sort((a, b) => b.depth - a.depth);
    for (const item of drawables) item.draw();
  }

  function togglePause() {
    if (state.paused) {
      state.startTime = performance.now();
      state.paused = false;
    } else {
      state.frozenElapsed = elapsedTime(performance.now());
      state.paused = true;
    }
  }

  // ---- live camera control ------------------------------------------------
  // Drag orbits the camera (azimuth + elevation), shift-drag rolls it,
  // cmd-drag slides the Sun anchor, scroll zooms, alt-scroll dollies in and out
  // of perspective. Nothing here is baked in: C prints the numbers as a preset.

  const drag = { active: false, mode: null, x: 0, y: 0 };

  function dragMode(event) {
    if (event.button === 2 || event.metaKey || event.ctrlKey) return "pan";
    if (event.shiftKey) return "roll";
    return "orbit";
  }

  canvas.addEventListener("contextmenu", event => event.preventDefault());

  canvas.addEventListener("pointerdown", event => {
    drag.active = true;
    drag.mode = dragMode(event);
    drag.x = event.clientX;
    drag.y = event.clientY;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* pen/touch quirks */ }
    if (camera.hidden) { camera.hidden = false; updateReadout(); }
  });

  canvas.addEventListener("pointermove", event => {
    if (!drag.active) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const v = view();

    if (drag.mode === "orbit") {
      v.azimuth = wrap(v.azimuth + dx * 0.35);
      // Dragging down tips the plane toward you, i.e. raises the viewpoint.
      v.elevation = clamp(v.elevation + dy * 0.28, -89, 89);
    } else if (drag.mode === "roll") {
      v.roll = wrap((v.roll || 0) + dx * 0.25);
    } else {
      v.sunX = clamp(v.sunX + dx / state.width, -0.6, 1.6);
      v.sunY = clamp(v.sunY + dy / state.height, -0.6, 1.6);
    }
    markCustom();
    refreshCamera();
  });

  const endDrag = () => { drag.active = false; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const v = view();
    const factor = Math.exp(-event.deltaY * 0.0015);
    if (event.altKey) {
      // Past 22 the perspective divide is indistinguishable from none, so hand
      // it back to the cheaper orthographic path.
      const next = (v.distance || 6) * factor;
      if (next > 22) delete v.distance;
      else v.distance = clamp(next, 1.2, 22);
    } else {
      v.zoom = clamp(v.zoom * factor, 0.15, 14);
    }
    markCustom();
    refreshCamera();
    if (camera.hidden) { camera.hidden = false; updateReadout(); }
  }, { passive: false });

  async function copyPreset() {
    const line = presetLine();
    try {
      await navigator.clipboard.writeText(line);
      status.textContent = "Preset copied to clipboard — paste it into VIEWS in app.js";
    } catch {
      console.log(line);
      status.textContent = "Clipboard blocked — preset printed to the browser console";
    }
    setTimeout(describeView, 2600);
  }

  addEventListener("resize", resize, { passive: true });
  addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (event.code === "Space") { event.preventDefault(); togglePause(); }
    if (key === "l") state.labels = !state.labels;
    if (key === "o") state.orbits = !state.orbits;
    if (key === "h") help.hidden = !help.hidden;
    if (key === "k") { camera.hidden = !camera.hidden; updateReadout(); }
    if (key === "c") copyPreset();
    if (key === "r") applyView();                       // discard edits
    if (key === "v") applyView((state.viewIndex + 1) % VIEWS.length);

    const v = view();
    if (key === "-" || key === "_") { v.bodies = clamp(v.bodies * 0.92, 0.1, 4); markCustom(); refreshCamera(); }
    if (key === "=" || key === "+") { v.bodies = clamp(v.bodies * 1.08, 0.1, 4); markCustom(); refreshCamera(); }

    // Arrow keys nudge the same axes as dragging, for fine tuning.
    const step = event.shiftKey ? 0.5 : 2;
    if (key === "arrowleft")  { v.azimuth = wrap(v.azimuth - step); markCustom(); refreshCamera(); event.preventDefault(); }
    if (key === "arrowright") { v.azimuth = wrap(v.azimuth + step); markCustom(); refreshCamera(); event.preventDefault(); }
    if (key === "arrowup")    { v.elevation = clamp(v.elevation - step, -89, 89); markCustom(); refreshCamera(); event.preventDefault(); }
    if (key === "arrowdown")  { v.elevation = clamp(v.elevation + step, -89, 89); markCustom(); refreshCamera(); event.preventDefault(); }
  });

  async function init() {
    resize();
    try {
      await loadAssets();
      applyView();
      updateEphemeris();
      loading.classList.add("done");
      setTimeout(() => loading.remove(), 700);
      requestAnimationFrame(render);
    } catch (error) {
      console.error(error);
      loading.innerHTML = "Could not load the local watercolor assets.";
    }
  }

  init();
})();
