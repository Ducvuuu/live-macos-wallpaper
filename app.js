(() => {
  "use strict";

  const wallpaper = document.querySelector("#wallpaper");
  const canvas = document.querySelector("#scene");
  // Not const: the scene cache retargets every drawing helper at an offscreen
  // buffer by swapping this binding, rather than threading a context argument
  // through two dozen paint functions.
  let ctx = canvas.getContext("2d", { alpha: true });
  const loading = document.querySelector("#loading");
  const status = document.querySelector("#status");
  const help = document.querySelector("#help");
  const camera = document.querySelector("#camera");
  const positions = document.querySelector("#positions");
  const positionList = document.querySelector("#position-list");
  const simDate = document.querySelector("#sim-date");
  const dayCounter = document.querySelector("#day-counter");
  const reverseTime = document.querySelector("#reverse-time");
  const pauseTime = document.querySelector("#pause-time");
  const forwardTime = document.querySelector("#forward-time");
  const speedControls = [...document.querySelectorAll("[data-speed]")];
  const today = document.querySelector("#today");
  const earthFocus = document.querySelector("#earth-focus");
  const earthLightingMode = document.querySelector("#earth-lighting-mode");
  const zenModeSelect = document.querySelector("#zen-mode");
  const zenToggle = document.querySelector("#zen-toggle");
  const zenIndicator = document.querySelector("#zen-indicator");

  const DEG = Math.PI / 180;
  const DAY = 86400000;
  const AU_KM = 149597870.7;
  const SUN_RADIUS_AU = 696340 / AU_KM;
  const EARTH_RADIUS_AU = 6378.137 / AU_KM;
  const MOON_RADIUS_AU = 1737.4 / AU_KM;
  const SPEEDS = [
    { label: "Real time", rate: 1, refresh: 60000 },
    { label: "1 hour/second", rate: 3600, refresh: 250 },
    { label: "1 day/second", rate: DAY / 1000, refresh: 100 },
    { label: "30 days/second", rate: 30 * DAY / 1000, refresh: 1000 / 30 },
    { label: "1 year/second", rate: 365.256 * DAY / 1000, refresh: 1000 / 30 }
  ];
  const ZEN_MODES = ["astronomical", "ambient", "dream"];
  const ZEN_LABELS = {
    astronomical: "Astronomical Zen",
    ambient: "Ambient Zen",
    dream: "Dream Zen"
  };
  const DREAM_PERIODS = {
    Mercury: 82, Venus: 112, Earth: 148, Mars: 192,
    Jupiter: 252, Saturn: 324, Uranus: 408, Neptune: 492
  };
  const ZEN_SPIN_PERIODS = {
    Mercury: 96, Venus: 132, Earth: 68, Mars: 74,
    Jupiter: 54, Saturn: 60, Uranus: 88, Neptune: 78, Moon: 104
  };
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
    { name: "Illustration", elevation: 29.1, azimuth: 46.4, roll: 339.9, sunX: 0.60, sunY: 0.50, zoom: 0.96, bodies: 0.86, distance: 2.3 },
    { name: "Wide",     elevation: 27, azimuth: 300, sunX: 0.53, sunY: 0.47, zoom: 1.00, bodies: 0.62 },
    { name: "Close",    elevation: 16, azimuth: 300, sunX: 0.78, sunY: 0.54, zoom: 2.35, bodies: 1.15 },
    { name: "Tabletop", elevation: 62, azimuth: 300, sunX: 0.50, sunY: 0.50, zoom: 1.00, bodies: 0.55 }
  ];
  const EARTH_FOCUS_VIEW = {
    name: "Earth Focus",
    elevation: 50.4,
    azimuth: 45.0,
    roll: 339.9,
    sunX: 0.60,
    sunY: 0.50,
    zoom: 0.96,
    bodies: 0.86,
    distance: 2.30
  };
  const textureRoot = "assets/textures/";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Host configuration. In a browser tab nothing here applies and the page
  // behaves exactly as it always has. The macOS wallpaper host sets
  // window.__WALLPAPER__ before this script runs; ?mode=wallpaper does the
  // same thing from the address bar, which is how to preview desktop
  // behaviour without building the app.
  //
  // A desktop wallpaper differs from a tab in two ways that matter:
  //   - it is painted for hours, so frames are a battery cost, not free
  //   - it receives no pointer or keyboard events at all, so anything that
  //     keys off "the user has gone idle" would latch on permanently
  const host = (() => {
    const injected = window.__WALLPAPER__ || {};
    const params = new URLSearchParams(location.search);
    const wallpaper = injected.mode === "wallpaper" || params.get("mode") === "wallpaper";
    const positive = (key, fallback) => {
      const value = Number(injected[key] ?? params.get(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return {
      wallpaper,
      // At real-time speed the scene is very nearly static — planets move
      // imperceptibly and only the twinkle and Sun shimmer change. Painting
      // it 30 times a second is almost entirely wasted work, so the desktop
      // idles slowly and only speeds up when something is actually moving.
      frameRate: positive("fps", wallpaper ? 10 : 30),
      activeFrameRate: positive("activeFps", wallpaper ? 20 : 30),
      zenFrameRate: positive("zenFps", wallpaper ? 45 : 30),
      // How long a cached scene may be reused before it is repainted to keep
      // the Sun's shimmer alive. 0 disables the cache entirely, which is the
      // tab default so browser behaviour is bit-for-bit what it always was.
      sceneInterval: Number(injected.sceneInterval ?? params.get("sceneInterval") ?? (wallpaper ? 500 : 0)),
      // Idle Zen is the whole point in a tab and a trap on the desktop: with
      // no events arriving it would engage after 45s and never release,
      // running the calendar away from today at six hours a second.
      autoZen: typeof injected.autoZen === "boolean" ? injected.autoZen : !wallpaper,
      // How much a planet may rotate before its texture is rebuilt, as a
      // multiple of the exact threshold. Rebuilding every sphere every frame
      // is what limits Zen; a looser tolerance trades imperceptible steps in
      // planet spin for a visibly smoother camera. 1 is the exact behaviour.
      textureTolerance: positive("textureTolerance", wallpaper ? 6 : 1)
    };
  })();

  // Orbital display sizes remain illustrative. Spin-axis direction and
  // rotational phase are supplied separately by Astronomy Engine for the
  // current simulation date.
  const planets = [
    { name: "Mercury", radius: 10, period: 87.969, color: "#d8c5ad" },
    { name: "Venus",   radius: 17, period: 224.701, color: "#e4af72" },
    { name: "Earth",   radius: 22, period: 365.256, color: "#8eb2be" },
    { name: "Mars",    radius: 15, period: 686.980, color: "#c97958" },
    { name: "Jupiter", radius: 42, period: 4332.59, color: "#cda17f" },
    { name: "Saturn",  radius: 34, period: 10759.2, color: "#d7bc8e", rings: true },
    { name: "Uranus",  radius: 25, period: 30688.5, color: "#9bc5c3" },
    { name: "Neptune", radius: 25, period: 60182, color: "#718cae" }
  ];

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    images: new Map(),
    sphereBuffers: new WeakMap(),
    lightingBuffers: new Map(),
    vectors: new Map(),
    axes: new Map(),
    orbitVectors: new Map(),
    moonOrbitVectors: [],
    orbitOccluders: [],
    cameraAxis: { x: 1, y: 0 },
    basis: null,
    viewIndex: 0,
    earthFocusView: Object.assign({}, EARTH_FOCUS_VIEW),
    labels: false,
    orbits: true,
    paused: reducedMotion,
    startTime: performance.now(),
    pausedAt: 0,
    frozenElapsed: 0,
    lastEphemeris: 0,
    lastFrame: 0,
    renderedFrames: 0,
    // Raw requestAnimationFrame cadence, needed to rate-cap without aliasing.
    lastTick: 0,
    tickInterval: 0,
    rafTicks: 0,
    sceneBuffer: null,
    sceneCtx: null,
    sceneSignature: null,
    sceneStamp: 0,
    sceneRepaints: 0,
    renderingSuspended: false,
    lastClockUi: 0,
    timeOrigin: Date.now(),
    timeAnchor: Date.now(),
    timeRealAnchor: performance.now(),
    timeDirection: 1,
    speedIndex: 0,
    positionRows: new Map(),
    zenMode: null,
    zenSelection: "astronomical",
    zenStart: 0,
    zenBaseView: null,
    zenView: null,
    zenSpinStart: new Map(),
    dreamOffsets: new Map(),
    lastInteraction: performance.now(),
    earthFocus: false,
    earthLightingMode: "accurate",
    eclipseDemoStart: performance.now()
  };

  const calendarFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const statusFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const wrap = degrees => ((degrees % 360) + 360) % 360;

  function simulationRate() {
    if (state.zenMode === "astronomical") return 6 * 3600;
    if (state.zenMode === "ambient" || state.zenMode === "dream") return 1;
    return SPEEDS[state.speedIndex].rate;
  }

  function simulatedTime(now = performance.now()) {
    if (state.paused) return state.timeAnchor;
    const elapsed = now - state.timeRealAnchor;
    return state.timeAnchor + elapsed * state.timeDirection * simulationRate();
  }

  function rebaseSimulation(now = performance.now()) {
    state.timeAnchor = simulatedTime(now);
    state.timeRealAnchor = now;
  }

  function updateTransportUi() {
    reverseTime.setAttribute("aria-pressed", String(!state.paused && state.timeDirection < 0));
    forwardTime.setAttribute("aria-pressed", String(!state.paused && state.timeDirection > 0));
    pauseTime.setAttribute("aria-pressed", String(state.paused));
    pauseTime.textContent = state.paused ? "▶" : "Ⅱ";
    pauseTime.setAttribute("aria-label", state.paused ? "Resume time" : "Pause time");
    for (const button of speedControls) {
      button.classList.toggle("active", Number(button.dataset.speed) === state.speedIndex);
      button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === state.speedIndex));
    }
  }

  function updateTimeReadout(dateMs, now = performance.now(), force = false) {
    const interval = state.speedIndex === 0 ? 500 : 80;
    if (!force && now - state.lastClockUi < interval) return;
    state.lastClockUi = now;
    simDate.dateTime = new Date(dateMs).toISOString();
    simDate.textContent = calendarFormatter.format(new Date(dateMs));
    const days = Math.round((dateMs - state.timeOrigin) / DAY);
    dayCounter.textContent = `Day ${days < 0 ? "−" : "+"}${Math.abs(days).toLocaleString()}`;
  }

  function setSimulationSpeed(index) {
    const now = performance.now();
    rebaseSimulation(now);
    state.speedIndex = clamp(index, 0, SPEEDS.length - 1);
    state.lastEphemeris = 0;
    updateTransportUi();
    updateTimeReadout(state.timeAnchor, now, true);
    describeView();
  }

  function setTimeDirection(direction) {
    const now = performance.now();
    rebaseSimulation(now);
    state.timeDirection = direction < 0 ? -1 : 1;
    if (state.paused) {
      state.startTime = now;
      state.paused = false;
    }
    state.timeRealAnchor = now;
    state.lastEphemeris = 0;
    updateTransportUi();
    describeView();
  }

  function returnToToday() {
    const now = performance.now();
    state.timeAnchor = Date.now();
    state.timeRealAnchor = now;
    state.timeDirection = 1;
    state.speedIndex = 0;
    if (state.paused) state.startTime = now;
    state.paused = false;
    state.lastEphemeris = 0;
    updateTransportUi();
    updateTimeReadout(state.timeAnchor, now, true);
    describeView();
  }

  function initializePositionPanel() {
    for (const planet of planets) {
      const row = document.createElement("div");
      row.className = "position-row";
      const name = document.createElement("span");
      name.className = "planet-name";
      name.textContent = planet.name;
      const longitude = document.createElement("span");
      longitude.className = "longitude";
      const distance = document.createElement("span");
      distance.className = "distance";
      row.append(name, longitude, distance);
      positionList.append(row);
      state.positionRows.set(planet.name, { longitude, distance });
    }
  }

  function updatePositionPanel() {
    for (const planet of planets) {
      const vector = state.vectors.get(planet.name);
      const row = state.positionRows.get(planet.name);
      if (!vector || !row) continue;
      const longitude = wrap(Math.atan2(vector.y, vector.x) / DEG);
      const distance = Math.hypot(vector.x, vector.y, vector.z);
      row.longitude.textContent = `${longitude.toFixed(1)}°`;
      row.distance.textContent = `${distance.toFixed(distance < 10 ? 2 : 1)} AU`;
    }
  }

  // The live camera is a mutable copy of a preset, so dragging never damages
  // the presets themselves — cycling with V always restores clean values.
  function view() {
    return state.zenView || (state.earthFocus ? state.earthFocusView : state.live);
  }

  function applyView(index = state.viewIndex) {
    state.viewIndex = index;
    state.live = Object.assign({}, VIEWS[index]);
    refreshCamera();
  }

  function refreshCamera() {
    refreshProjection();
    describeView();
    updateReadout();
  }

  function refreshProjection() {
    state.basis = cameraBasis();
    const roll = (view().roll || 0) * DEG;
    state.roll = roll ? { cos: Math.cos(roll), sin: Math.sin(roll) } : null;
    const azimuth = view().azimuth * DEG;
    state.cameraAxis = { x: Math.cos(azimuth), y: Math.sin(azimuth) };
  }

  function initializeDreamOffsets() {
    state.dreamOffsets.clear();
    for (const planet of planets) {
      const points = state.orbitVectors.get(planet.name);
      const current = state.vectors.get(planet.name);
      if (!points || !current) continue;
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let i = 0; i < points.length - 1; i++) {
        const point = points[i];
        const distance = Math.hypot(point.x - current.x, point.y - current.y, point.z - current.z);
        if (distance < nearestDistance) {
          nearest = i;
          nearestDistance = distance;
        }
      }
      state.dreamOffsets.set(planet.name, nearest);
    }
  }

  function enterZen(mode = state.zenSelection) {
    if (!ZEN_MODES.includes(mode)) mode = "astronomical";
    const now = performance.now();

    // Every Zen mode begins from the active camera, including the dedicated
    // Earth Focus framing. Switching modes therefore preserves the scene.
    state.zenMode = null;
    state.zenView = null;
    returnToToday();
    updateEphemeris(new Date(state.timeAnchor), now);

    state.zenMode = mode;
    state.zenSelection = mode;
    state.zenStart = now;
    const activeView = state.earthFocus ? state.earthFocusView : state.live;
    state.zenBaseView = Object.assign({}, activeView);
    state.zenView = Object.assign({}, activeView);
    state.zenSpinStart.clear();
    for (const planet of planets) state.zenSpinStart.set(planet.name, state.axes.get(planet.name).spin);
    state.zenSpinStart.set("Moon", state.moonAxis.spin);
    if (mode === "dream") initializeDreamOffsets();

    state.timeAnchor = Date.now();
    state.timeRealAnchor = now;
    state.timeDirection = 1;
    state.paused = false;
    state.lastEphemeris = 0;
    zenModeSelect.value = mode;
    zenIndicator.textContent = ZEN_LABELS[mode];
    zenToggle.setAttribute("aria-pressed", "true");
    wallpaper.classList.add("zen-active");
    refreshProjection();
  }

  function exitZen() {
    if (!state.zenMode) return;
    state.zenMode = null;
    state.zenView = null;
    state.zenBaseView = null;
    state.dreamOffsets.clear();
    zenIndicator.textContent = "";
    zenToggle.setAttribute("aria-pressed", "false");
    wallpaper.classList.remove("zen-active");
    returnToToday();
    refreshCamera();
    state.lastInteraction = performance.now();
  }

  function cycleZenMode() {
    if (!state.zenMode) {
      enterZen(state.zenSelection);
      return;
    }
    const index = ZEN_MODES.indexOf(state.zenMode);
    enterZen(ZEN_MODES[(index + 1) % ZEN_MODES.length]);
  }

  function updateZenCamera(now) {
    if (!state.zenMode || !state.zenBaseView) return;
    const seconds = (now - state.zenStart) / 1000;
    const base = state.zenBaseView;
    const still = reducedMotion ? 0 : 1;
    state.zenView = Object.assign({}, base, {
      elevation: base.elevation + still * 1.5 * Math.sin(seconds * Math.PI * 2 / 71),
      azimuth: base.azimuth + still * 2.0 * Math.sin(seconds * Math.PI * 2 / 113),
      roll: wrap((base.roll || 0) + still * .5 * Math.sin(seconds * Math.PI * 2 / 89)),
      zoom: base.zoom * (1 + still * .01 * Math.sin(seconds * Math.PI * 2 / 59)),
      sunX: base.sunX + still * .010 * Math.sin(seconds * Math.PI * 2 / 101),
      sunY: base.sunY + still * .008 * Math.sin(seconds * Math.PI * 2 / 137)
    });
    refreshProjection();
  }

  function setEarthFocus(enabled = !state.earthFocus) {
    state.earthFocus = Boolean(enabled);
    if (state.earthFocus) state.earthFocusView = Object.assign({}, EARTH_FOCUS_VIEW);
    if (state.zenMode) {
      const activeView = state.earthFocus ? state.earthFocusView : state.live;
      state.zenBaseView = Object.assign({}, activeView);
      state.zenView = Object.assign({}, activeView);
      state.zenStart = performance.now();
    }
    earthFocus.setAttribute("aria-pressed", String(state.earthFocus));
    wallpaper.classList.toggle("earth-focus", state.earthFocus);
    state.lastInteraction = performance.now();
    refreshCamera();
  }

  function setEarthLighting(mode) {
    const modes = ["accurate", "demo", "off"];
    state.earthLightingMode = modes.includes(mode) ? mode : "accurate";
    earthLightingMode.value = state.earthLightingMode;
    if (state.earthLightingMode === "demo") state.eclipseDemoStart = performance.now();
    state.lastInteraction = performance.now();
    describeView();
  }

  function cycleEarthLighting() {
    if (!state.earthFocus) return;
    const modes = ["accurate", "demo", "off"];
    setEarthLighting(modes[(modes.indexOf(state.earthLightingMode) + 1) % modes.length]);
  }

  function markCustom() {
    view().name = "Custom";
  }

  function describeView() {
    if (!state.ephemerisDate) return;
    const stamp = statusFormatter.format(state.ephemerisDate);
    const nearNow = Math.abs(state.ephemerisDate.getTime() - Date.now()) < 5 * 60000;
    const live = nearNow && !state.paused && state.timeDirection === 1 && state.speedIndex === 0;
    const lighting = state.earthLightingMode === "demo" ? "eclipse demo" : state.earthLightingMode === "accurate" ? "dated light" : "light off";
    const framing = state.earthFocus ? `earth focus, ${lighting}` : `${view().name.toLowerCase()} view, ${Math.round(view().elevation)}° above ecliptic`;
    status.textContent = `${live ? "Live" : "Simulated"} positions · ${stamp} · ${framing}`;
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
      { key: "Sun", file: "sun.webp", color: "#f2b156" },
      { key: "Moon", file: "moon.webp", color: "#e8d7bd" }
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

    if (host.sceneInterval > 0) {
      if (!state.sceneBuffer) {
        state.sceneBuffer = document.createElement("canvas");
        state.sceneCtx = state.sceneBuffer.getContext("2d");
      }
      state.sceneBuffer.width = canvas.width;
      state.sceneBuffer.height = canvas.height;
      state.sceneCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      state.sceneSignature = null;      // force a repaint at the new size
    }
  }

  function eclipticVector(body, date) {
    const eqj = Astronomy.HelioVector(Astronomy.Body[body], date);
    return Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), eqj);
  }

  function rotationalState(body, date) {
    const axis = Astronomy.RotationAxis(Astronomy.Body[body], date);
    const ra = axis.ra * DEG;
    // At W=0 this equatorial direction lies on the body's prime meridian.
    // Carrying it with the pole allows an exact sub-camera longitude later.
    const referenceEqj = {
      x: -Math.sin(ra),
      y: Math.cos(ra),
      z: 0,
      t: axis.north.t
    };
    return {
      pole: Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), axis.north),
      reference: Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), referenceEqj),
      spin: axis.spin / 360
    };
  }

  function updateEphemeris(date = new Date(simulatedTime()), sampledAt = performance.now()) {
    for (const planet of planets) {
      state.vectors.set(planet.name, eclipticVector(planet.name, date));
      state.axes.set(planet.name, rotationalState(planet.name, date));
    }
    const moonEqj = Astronomy.GeoVector(Astronomy.Body.Moon, date, true);
    state.moonVector = Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), moonEqj);
    state.moonAxis = rotationalState("Moon", date);

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

      // One real geocentric lunar revolution for the close Earth scene.
      // Directions are normalized later so the illustrated orbit can remain
      // readable without pretending the Earth-Moon distance is to scale.
      const moonPeriod = 27.321661;
      for (let i = 0; i <= 120; i++) {
        const offset = (i / 120 - 0.5) * moonPeriod * DAY;
        const vector = Astronomy.GeoVector(Astronomy.Body.Moon, new Date(date.getTime() + offset), true);
        state.moonOrbitVectors.push(Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), vector));
      }
    }
    state.lastEphemeris = sampledAt;
    state.ephemerisDate = date;
    updatePositionPanel();
    describeView();
  }

  function compressed(vector) {
    const radius = Math.hypot(vector.x, vector.y, vector.z) || 1;
    const displayRadius = Math.pow(Math.min(radius, 35) / 30.1, 0.28);
    const factor = displayRadius / radius;
    return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
  }

  function displayVector(planet, now) {
    if (state.zenMode !== "dream") return state.vectors.get(planet.name);
    const points = state.orbitVectors.get(planet.name);
    const start = state.dreamOffsets.get(planet.name) || 0;
    if (!points || points.length < 2) return state.vectors.get(planet.name);
    const count = points.length - 1;
    const elapsed = (now - state.zenStart) / 1000;
    const position = (start + (elapsed / DREAM_PERIODS[planet.name]) * count) % count;
    const index = Math.floor(position);
    const mix = position - index;
    const a = points[index];
    const b = points[(index + 1) % count];
    return {
      x: a.x + (b.x - a.x) * mix,
      y: a.y + (b.y - a.y) * mix,
      z: a.z + (b.z - a.z) * mix
    };
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
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  });

  const vectorLength = vector => Math.hypot(vector.x, vector.y, vector.z);

  function normalized(vector) {
    const length = vectorLength(vector) || 1;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function rotateAroundAxis(vector, axis, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const perpendicular = cross(axis, vector);
    const parallel = dot(axis, vector) * (1 - cosine);
    return {
      x: vector.x * cosine + perpendicular.x * sine + axis.x * parallel,
      y: vector.y * cosine + perpendicular.y * sine + axis.y * parallel,
      z: vector.z * cosine + perpendicular.z * sine + axis.z * parallel
    };
  }

  // Project Astronomy Engine's date-specific rotational pole through the live
  // camera. Its spin value is the body's real rotational phase in turns.
  function projectedAxis(axis) {
    const pole = axis.pole;
    const screen = rolledOffset(
      dot(pole, state.basis.right),
      -dot(pole, state.basis.up)
    );
    return {
      // Rotation that carries local screen-up onto the projected north pole.
      angle: Math.atan2(screen.x, -screen.y),
      // A circular equatorial ring foreshortens by this amount.
      flatten: clamp(Math.abs(dot(pole, state.basis.toward)), 0.08, 1),
      spin: axis.spin
    };
  }

  function cameraFacingTexture(axis) {
    const projected = projectedAxis(axis);
    const phase = axis.spin - Math.floor(axis.spin);
    const prime = rotateAroundAxis(axis.reference, axis.pole, phase * Math.PI * 2);
    const alongPole = dot(state.basis.toward, axis.pole);
    const equatorialView = {
      x: state.basis.toward.x - axis.pole.x * alongPole,
      y: state.basis.toward.y - axis.pole.y * alongPole,
      z: state.basis.toward.z - axis.pole.z * alongPole
    };
    const viewLength = Math.hypot(equatorialView.x, equatorialView.y, equatorialView.z);
    if (viewLength < 1e-7) return { rotation: phase, longitudeSign: 1 };
    equatorialView.x /= viewLength;
    equatorialView.y /= viewLength;
    equatorialView.z /= viewLength;

    const primeEast = cross(axis.pole, prime);
    const longitude = Math.atan2(dot(equatorialView, primeEast), dot(equatorialView, prime));
    const centerEast = cross(axis.pole, equatorialView);
    const screenEast = rolledOffset(
      dot(centerEast, state.basis.right),
      -dot(centerEast, state.basis.up)
    );
    const localRight = { x: Math.cos(projected.angle), y: Math.sin(projected.angle) };
    const longitudeSign = screenEast.x * localRight.x + screenEast.y * localRight.y < 0 ? -1 : 1;
    return { rotation: longitude / (Math.PI * 2), longitudeSign };
  }

  function zenSpin(name, actualSpin, now) {
    if (state.zenMode !== "ambient" && state.zenMode !== "dream") return actualSpin;
    const start = state.zenSpinStart.get(name) ?? actualSpin;
    const direction = name === "Venus" || name === "Uranus" ? -1 : 1;
    const elapsed = (now - state.zenStart) / 1000;
    return start + direction * elapsed / ZEN_SPIN_PERIODS[name];
  }

  function projectedPole(planet, now) {
    const projected = projectedAxis(state.axes.get(planet.name));
    projected.spin = zenSpin(planet.name, projected.spin, now);
    return projected;
  }

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

    // Keep every painted orbit clear of solid bodies. Depth sorting still
    // decides which arcs are near or far everywhere else, but a small halo
    // around each disc prevents a foreground arc from being painted across a
    // planet's texture.
    for (const body of state.orbitOccluders) {
      ctx.beginPath();
      ctx.rect(-1, -1, state.width + 2, state.height + 2);
      ctx.arc(body.x, body.y, body.radius + 3.5, 0, Math.PI * 2);
      ctx.clip("evenodd");
    }

    ctx.beginPath();
    ctx.moveTo(slice[0].x, slice[0].y);
    for (let i = 1; i < slice.length; i++) ctx.lineTo(slice[i].x, slice[i].y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Three imperfect, broken passes read as watercolor pencil and dry brush,
    // rather than one mathematically perfect vector ellipse.
    const phase = -((Math.abs(slice[0].x) + Math.abs(slice[0].y)) % 31);
    ctx.setLineDash([18, 5, 3, 8]);
    ctx.lineDashOffset = phase;
    ctx.strokeStyle = `rgba(221, 157, 108, ${0.10 * alpha})`;
    ctx.lineWidth = 4.0;
    ctx.stroke();

    ctx.setLineDash([25, 6, 3, 10]);
    ctx.lineDashOffset = phase - 7;
    ctx.strokeStyle = `rgba(255, 232, 195, ${0.48 * alpha})`;
    ctx.lineWidth = 1.05;
    ctx.stroke();

    ctx.setLineDash([10, 9, 2, 13]);
    ctx.lineDashOffset = phase + 11;
    ctx.strokeStyle = `rgba(239, 171, 119, ${0.32 * alpha})`;
    ctx.lineWidth = 0.62;
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
    const pulse = state.paused ? 1 : 1 + Math.sin(elapsed / 2600) * 0.008;

    // The generated texture supplies the painted energy. The procedural part
    // is deliberately restrained: a warm wash around the disc and a few loose
    // contour marks, rather than a white digital core that erases the artwork.
    const r = radius * pulse;
    ctx.save();
    ctx.globalCompositeOperation = "screen";

    const spread = ctx.createRadialGradient(x, y, r * .72, x, y, r * 2.35);
    spread.addColorStop(0, "rgba(255, 199, 130, .22)");
    spread.addColorStop(.42, "rgba(239, 155, 98, .075)");
    spread.addColorStop(1, "rgba(224, 128, 79, 0)");
    ctx.fillStyle = spread;
    ctx.fillRect(x - r * 2.35, y - r * 2.35, r * 4.7, r * 4.7);
    ctx.restore();

    const rotation = state.paused ? state.frozenElapsed / 720000 : elapsed / 720000;
    drawTexturedSphere(state.images.get("Sun"), x, y, r, rotation, true);

    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      const steps = 72;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const broken = ((i + pass * 13) % 27) > 21;
        const wobble = Math.sin(angle * 5 + pass * 1.7) * r * .014 + Math.sin(angle * 13) * r * .006;
        const rr = r * (pass ? .91 : .98) + wobble;
        const px = Math.cos(angle) * rr;
        const py = Math.sin(angle) * rr;
        if (i === 0 || broken) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = pass ? "rgba(255, 245, 214, .26)" : "rgba(255, 216, 159, .34)";
      ctx.lineWidth = pass ? .8 : 1.25;
      ctx.stroke();
    }
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

  function renderSphereTexture(image, radius, rotation, longitudeSign = 1) {
    let buffer = state.sphereBuffers.get(image);
    if (!buffer) {
      const canvas = document.createElement("canvas");
      buffer = { canvas, context: canvas.getContext("2d", { alpha: true }) };
      state.sphereBuffers.set(image, buffer);
    }

    // Quantise the buffer size. Zen breathes the zoom by about 1% a frame,
    // which otherwise changes the pixel radius constantly and invalidates
    // this cache on every single frame. Rounding up costs a little unused
    // resolution — the result is scaled to displaySize either way.
    const step = 8;
    const pixelRadius = Math.max(2, Math.ceil(radius * state.dpr / step) * step);
    const padding = 2;
    const diameter = pixelRadius * 2;
    const size = diameter + padding * 2;
    const resized = buffer.canvas.width !== size || buffer.canvas.height !== size;
    if (resized) {
      buffer.canvas.width = size;
      buffer.canvas.height = size;
    }

    const phase = rotation - Math.floor(rotation);
    const phaseGap = buffer.phase == null ? Infinity : Math.abs(phase - buffer.phase);
    const wrappedGap = Math.min(phaseGap, 1 - Math.min(phaseGap, 1));
    const needsRedraw = resized || buffer.longitudeSign !== longitudeSign
      || wrappedGap > host.textureTolerance * .25 / image.width;
    if (!needsRedraw) {
      return { canvas: buffer.canvas, displaySize: size * radius / pixelRadius };
    }
    buffer.phase = phase;
    buffer.longitudeSign = longitudeSign;

    const bctx = buffer.context;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, size, size);
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.save();
    bctx.beginPath();
    bctx.arc(size / 2, size / 2, pixelRadius + .25, 0, Math.PI * 2);
    bctx.clip();

    // Assemble the longitude slices on an axis-aligned offscreen surface.
    // Their small overlap seals sampling gaps without softening the artwork.
    for (let column = 0; column < diameter; column++) {
      const nx = (column + .5 - pixelRadius) / pixelRadius;
      if (Math.abs(nx) > 1) continue;
      const longitude = longitudeSign * Math.asin(nx) / (Math.PI * 2);
      let u = phase + longitude + .5;
      u -= Math.floor(u);
      const sourceX = Math.floor(u * image.width) % image.width;
      bctx.drawImage(image, sourceX, 0, 1, image.height, padding + column - .25, padding, 1.5, diameter);
    }
    bctx.restore();

    return {
      canvas: buffer.canvas,
      displaySize: size * radius / pixelRadius
    };
  }

  function drawTexturedSphere(image, x, y, radius, rotation, isSun = false, light = { x: -0.6, y: -0.7 }, axisAngle = 0, longitudeSign = 1, physicalLighting = false) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    // Rotate one completed texture disc instead of rotating hundreds of
    // independently antialiased strips. This keeps axial tilt without seams.
    const texture = renderSphereTexture(image, radius, rotation, longitudeSign);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(axisAngle);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(texture.canvas, -texture.displaySize / 2, -texture.displaySize / 2, texture.displaySize, texture.displaySize);
    ctx.restore();

    if (!isSun && !physicalLighting) {
      // Almost-flat illumination keeps every body in the same watercolor plane
      // as the background. Direction is still readable, but there is no hard
      // terminator or glossy 3D crescent.
      const shade = ctx.createRadialGradient(
        x + light.x * radius * .38, y + light.y * radius * .38, radius * .08,
        x - light.x * radius * .20, y - light.y * radius * .20, radius * 1.28
      );
      shade.addColorStop(0, "rgba(255, 247, 220, .075)");
      shade.addColorStop(.54, "rgba(30, 43, 61, .015)");
      shade.addColorStop(1, "rgba(13, 23, 39, .16)");
      ctx.fillStyle = shade;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

      ctx.globalCompositeOperation = "screen";
      const rim = ctx.createRadialGradient(
        x + light.x * radius, y + light.y * radius, radius * .04,
        x + light.x * radius, y + light.y * radius, radius * 1.05
      );
      rim.addColorStop(0, "rgba(255, 230, 180, .11)");
      rim.addColorStop(.45, "rgba(255, 212, 150, .035)");
      rim.addColorStop(1, "rgba(255, 200, 130, 0)");
      ctx.fillStyle = rim;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    } else if (isSun) {
      ctx.globalCompositeOperation = "screen";
      const core = ctx.createRadialGradient(x - radius * .25, y - radius * .3, 0, x, y, radius);
      core.addColorStop(0, "rgba(255,255,225,.10)");
      core.addColorStop(1, "rgba(255,203,120,.015)");
      ctx.fillStyle = core;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    if (!isSun) {
      // A trace of color bleed unifies the painted edge with the paper sky.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const halo = ctx.createRadialGradient(
        x + light.x * radius * .3, y + light.y * radius * .3, radius * .92,
        x, y, radius * 1.5
      );
      halo.addColorStop(0, "rgba(255, 222, 172, .055)");
      halo.addColorStop(1, "rgba(255, 210, 150, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = isSun ? "rgba(255, 228, 168, .42)" : "rgba(248, 226, 194, .16)";
    ctx.lineWidth = isSun ? 1.0 : .7;
    ctx.beginPath();
    ctx.arc(x, y, radius - .55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawSaturnRings(x, y, radius, pole, front = false) {
    // Saturn's rings lie in its equatorial plane. Their angle and
    // foreshortening therefore come from Saturn's real projected pole.
    const flatten = pole.flatten;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pole.angle);
    ctx.scale(1, flatten);
    ctx.lineCap = "round";
    ctx.setLineDash(front ? [radius * .68, radius * .10, radius * .12, radius * .16] : [radius * .82, radius * .08, radius * .18, radius * .13]);
    ctx.strokeStyle = front ? "rgba(240, 216, 178, .64)" : "rgba(201, 166, 126, .38)";
    ctx.lineWidth = (front ? 4.8 : 7) / flatten;
    ctx.beginPath();
    if (front) ctx.arc(0, 0, radius * 1.72, 0, Math.PI);
    else ctx.ellipse(0, 0, radius * 1.72, radius * 1.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([radius * .92, radius * .12, radius * .20, radius * .18]);
    ctx.lineDashOffset = -radius * .23;
    ctx.strokeStyle = "rgba(252, 238, 207, .48)";
    ctx.lineWidth = 1.15 / flatten;
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

  function rolledOffset(x, y) {
    const r = state.roll;
    if (!r) return { x, y };
    return { x: x * r.cos - y * r.sin, y: x * r.sin + y * r.cos };
  }

  // The Moon uses its real geocentric direction, but its visual separation is
  // enlarged so the companion remains legible at wallpaper scale. Its orbit is
  // split into depth-bearing painted arcs, just like the planetary paths: the
  // far half paints before Earth and the near half paints after it.
  function collectMoonSystem(earthPoint, earthRadius, now, out) {
    if (!state.moonVector) return;
    const basis = state.basis;
    const distance = Math.max(earthRadius * 3.0, 24);
    const length = Math.hypot(state.moonVector.x, state.moonVector.y, state.moonVector.z) || 1;
    let moonDirection;
    if (state.zenMode === "dream") {
      const angle = ((now - state.zenStart) / 1000 / 38) * Math.PI * 2;
      moonDirection = { x: Math.cos(angle), y: Math.sin(angle) * Math.cos(5.15 * DEG), z: Math.sin(angle) * Math.sin(5.15 * DEG) };
    } else {
      moonDirection = {
        x: state.moonVector.x / length,
        y: state.moonVector.y / length,
        z: state.moonVector.z / length
      };
    }

    if (state.orbits) {
      const points = [];
      const tilt = 5.15 * DEG;
      for (let i = 0; i <= 96; i++) {
        const angle = (i / 96) * Math.PI * 2;
        const local = {
          x: Math.cos(angle),
          y: Math.sin(angle) * Math.cos(tilt),
          z: Math.sin(angle) * Math.sin(tilt)
        };
        const offset = rolledOffset(dot(local, basis.right) * distance, -dot(local, basis.up) * distance);
        points.push({
          x: earthPoint.x + offset.x,
          y: earthPoint.y + offset.y,
          depth: earthPoint.depth - dot(local, basis.toward) * .035
        });
      }

      let nearest = Infinity;
      let farthest = -Infinity;
      for (const point of points) {
        nearest = Math.min(nearest, point.depth);
        farthest = Math.max(farthest, point.depth);
      }
      const span = farthest - nearest || 1;
      for (let i = 0; i < points.length - 1; i += 4) {
        const slice = points.slice(i, Math.min(i + 5, points.length));
        const depth = slice.reduce((sum, point) => sum + point.depth, 0) / slice.length;
        const away = (depth - nearest) / span;
        out.push({ depth, draw: () => strokeArc(slice, .78 * (1 - away * .55)) });
      }
    }

    const moonOffset = rolledOffset(
      dot(moonDirection, basis.right) * distance,
      -dot(moonDirection, basis.up) * distance
    );
    const moonPoint = {
      x: earthPoint.x + moonOffset.x,
      y: earthPoint.y + moonOffset.y,
      depth: earthPoint.depth - dot(moonDirection, basis.toward) * .035
    };
    const moonRadius = Math.max(3.4, earthRadius * .28);
    const moonPole = projectedAxis(state.moonAxis);
    moonPole.spin = zenSpin("Moon", moonPole.spin, now);
    state.orbitOccluders.push({ x: moonPoint.x, y: moonPoint.y, radius: moonRadius });
    out.push({
      depth: moonPoint.depth,
      draw: () => {
        const light = lightDirection(moonPoint.x, moonPoint.y);
        drawTexturedSphere(state.images.get("Moon"), moonPoint.x, moonPoint.y, moonRadius, moonPole.spin, false, light, moonPole.angle);
        if (state.labels) drawLabel("Moon", moonPoint.x, moonPoint.y, moonRadius);
      }
    });
  }

  function earthToSunVector() {
    const earth = state.vectors.get("Earth");
    return earth ? { x: -earth.x, y: -earth.y, z: -earth.z } : { x: 1, y: 0, z: 0 };
  }

  function earthFocusSunVector() {
    const actual = earthToSunVector();
    if (state.earthLightingMode !== "demo" || !state.basis) return actual;
    // Keep the teaching eclipse on the visible hemisphere. The demo label and
    // selector make this deliberately staged direction distinct from Accurate.
    const direction = normalized({
      x: state.basis.toward.x * .82 + state.basis.right.x * .45 + state.basis.up.x * .16,
      y: state.basis.toward.y * .82 + state.basis.right.y * .45 + state.basis.up.y * .16,
      z: state.basis.toward.z * .82 + state.basis.right.z * .45 + state.basis.up.z * .16
    });
    const distance = vectorLength(actual);
    return { x: direction.x * distance, y: direction.y * distance, z: direction.z * distance };
  }

  function earthFocusMoonVector(now) {
    if (state.earthLightingMode === "demo") {
      const sunward = normalized(earthFocusSunVector());
      const distance = vectorLength(state.moonVector) || .00257;
      let across = normalized(cross(sunward, { x: 0, y: 0, z: 1 }));
      if (vectorLength(across) < .1) across = normalized(cross(sunward, { x: 1, y: 0, z: 0 }));
      const vertical = normalized(cross(sunward, across));
      const phase = reducedMotion ? 0 : ((now - state.eclipseDemoStart) / 24000) * Math.PI * 2;
      const sweep = Math.sin(phase) * EARTH_RADIUS_AU * .84;
      const bow = Math.sin(phase * .5) * EARTH_RADIUS_AU * .12;
      return {
        x: sunward.x * distance + across.x * sweep + vertical.x * bow,
        y: sunward.y * distance + across.y * sweep + vertical.y * bow,
        z: sunward.z * distance + across.z * sweep + vertical.z * bow
      };
    }
    return state.moonVector;
  }

  function earthFocusMoonDirection(now, moonVector = earthFocusMoonVector(now)) {
    const length = vectorLength(moonVector) || 1;
    if (state.zenMode !== "dream" || state.earthLightingMode === "demo") {
      return {
        x: moonVector.x / length,
        y: moonVector.y / length,
        z: moonVector.z / length
      };
    }

    // Dream deliberately replaces the shared calendar with a presentation
    // orbit. Every other Earth Focus mode uses the exact geocentric direction.
    const base = Math.atan2(moonVector.y, moonVector.x);
    const period = 58;
    const angle = base + ((now - state.zenStart) / 1000 / period) * Math.PI * 2;
    const tilt = 5.15 * DEG;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle) * Math.cos(tilt),
      z: Math.sin(angle) * Math.sin(tilt)
    };
  }

  function screenLight(vector) {
    const light = normalized(vector);
    return {
      x: dot(light, state.basis.right),
      y: -dot(light, state.basis.up),
      z: dot(light, state.basis.toward)
    };
  }

  function lightingMask(radius, light, darkness) {
    const diameter = Math.max(8, Math.min(380, Math.round(radius * 2)));
    const quantize = value => Math.round(value * 50);
    const key = `${diameter}:${quantize(light.x)}:${quantize(light.y)}:${quantize(light.z)}:${darkness}`;
    if (state.lightingBuffers.has(key)) return state.lightingBuffers.get(key);

    const buffer = document.createElement("canvas");
    buffer.width = diameter;
    buffer.height = diameter;
    const bctx = buffer.getContext("2d");
    const pixels = bctx.createImageData(diameter, diameter);
    const half = diameter / 2;
    for (let y = 0; y < diameter; y++) {
      for (let x = 0; x < diameter; x++) {
        const nx = (x + .5 - half) / half;
        const ny = (y + .5 - half) / half;
        const disc = 1 - nx * nx - ny * ny;
        if (disc <= 0) continue;
        const nz = Math.sqrt(disc);
        const incidence = nx * light.x + ny * light.y + nz * light.z;
        const blend = clamp((incidence + .075) / .18, 0, 1);
        const smooth = blend * blend * (3 - 2 * blend);
        const alpha = darkness * (1 - smooth);
        const index = (y * diameter + x) * 4;
        pixels.data[index] = 7;
        pixels.data[index + 1] = 15;
        pixels.data[index + 2] = 34;
        pixels.data[index + 3] = Math.round(alpha * 255);
      }
    }
    bctx.putImageData(pixels, 0, 0);
    state.lightingBuffers.set(key, buffer);
    if (state.lightingBuffers.size > 90) state.lightingBuffers.delete(state.lightingBuffers.keys().next().value);
    return buffer;
  }

  function drawPhysicalLighting(x, y, radius, lightVector, body) {
    if (state.earthLightingMode === "off") return;
    const light = screenLight(lightVector);
    const mask = lightingMask(radius, light, body === "Earth" ? .66 : .72);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(mask, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  function drawShadowCircle(body, center, radius, shadow) {
    if (!shadow || shadow.penumbra <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
    ctx.clip();
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shadow.penumbra);
    gradient.addColorStop(0, shadow.umbra > 0 ? "rgba(13, 15, 26, .88)" : "rgba(45, 31, 35, .60)");
    const umbraStop = clamp(shadow.umbra / shadow.penumbra, .012, .92);
    gradient.addColorStop(umbraStop, shadow.umbra > 0 ? "rgba(25, 24, 34, .76)" : "rgba(70, 46, 42, .46)");
    gradient.addColorStop(Math.min(.98, umbraStop + .2), "rgba(39, 35, 44, .25)");
    gradient.addColorStop(1, "rgba(39, 35, 44, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center.x, center.y, shadow.penumbra, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

  }

  function drawSolarEclipseShadow(earthBody, moonVector, sunVector) {
    const ray = normalized({ x: moonVector.x - sunVector.x, y: moonVector.y - sunVector.y, z: moonVector.z - sunVector.z });
    const along = -dot(moonVector, ray);
    if (along <= 0) return;
    const closest = {
      x: moonVector.x + ray.x * along,
      y: moonVector.y + ray.y * along,
      z: moonVector.z + ray.z * along
    };
    const sunMoonDistance = vectorLength({ x: sunVector.x - moonVector.x, y: sunVector.y - moonVector.y, z: sunVector.z - moonVector.z });
    const penumbraAu = MOON_RADIUS_AU + along * (SUN_RADIUS_AU + MOON_RADIUS_AU) / sunMoonDistance;
    if (vectorLength(closest) > EARTH_RADIUS_AU + penumbraAu) return;
    const discriminant = dot(moonVector, ray) ** 2 - (dot(moonVector, moonVector) - EARTH_RADIUS_AU ** 2);
    if (discriminant < 0) return;
    const hitDistance = -dot(moonVector, ray) - Math.sqrt(discriminant);
    const hit = {
      x: moonVector.x + ray.x * hitDistance,
      y: moonVector.y + ray.y * hitDistance,
      z: moonVector.z + ray.z * hitDistance
    };
    const normal = normalized(hit);
    if (dot(normal, state.basis.toward) < -.08) return;
    const umbraAu = MOON_RADIUS_AU - hitDistance * (SUN_RADIUS_AU - MOON_RADIUS_AU) / sunMoonDistance;
    const shadow = {
      penumbra: penumbraAu / EARTH_RADIUS_AU * earthBody.radius,
      umbra: umbraAu / EARTH_RADIUS_AU * earthBody.radius
    };
    const center = {
      x: earthBody.x + dot(normal, state.basis.right) * earthBody.radius,
      y: earthBody.y - dot(normal, state.basis.up) * earthBody.radius
    };
    drawShadowCircle(earthBody, center, earthBody.radius, shadow);
  }

  function drawLunarEclipseShadow(moonBody, moonVector, sunVector) {
    const axis = normalized({ x: -sunVector.x, y: -sunVector.y, z: -sunVector.z });
    const along = dot(moonVector, axis);
    if (along <= 0) return;
    const offset = {
      x: moonVector.x - axis.x * along,
      y: moonVector.y - axis.y * along,
      z: moonVector.z - axis.z * along
    };
    const sunDistance = vectorLength(sunVector);
    const penumbraAu = EARTH_RADIUS_AU + along * (SUN_RADIUS_AU + EARTH_RADIUS_AU) / sunDistance;
    if (vectorLength(offset) > penumbraAu + MOON_RADIUS_AU) return;
    const umbraAu = Math.max(0, EARTH_RADIUS_AU - along * (SUN_RADIUS_AU - EARTH_RADIUS_AU) / sunDistance);
    const shadowCenterVector = { x: -offset.x, y: -offset.y, z: -offset.z };
    const center = {
      x: moonBody.x + dot(shadowCenterVector, state.basis.right) / MOON_RADIUS_AU * moonBody.radius,
      y: moonBody.y - dot(shadowCenterVector, state.basis.up) / MOON_RADIUS_AU * moonBody.radius
    };
    drawShadowCircle(moonBody, center, moonBody.radius, {
      penumbra: penumbraAu / MOON_RADIUS_AU * moonBody.radius,
      umbra: umbraAu / MOON_RADIUS_AU * moonBody.radius
    });
  }

  function drawEarthFocusMoonOrbit(center, distance) {
    if (!state.moonOrbitVectors.length) return;
    const points = state.moonOrbitVectors.map(vector => {
      const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
      const direction = { x: vector.x / length, y: vector.y / length, z: vector.z / length };
      return {
        x: center.x + dot(direction, state.basis.right) * distance,
        y: center.y - dot(direction, state.basis.up) * distance,
        depth: -dot(direction, state.basis.toward)
      };
    });
    let nearest = Infinity;
    let farthest = -Infinity;
    for (const point of points) {
      nearest = Math.min(nearest, point.depth);
      farthest = Math.max(farthest, point.depth);
    }
    const span = farthest - nearest || 1;
    for (let i = 0; i < points.length - 1; i += 5) {
      const slice = points.slice(i, Math.min(i + 6, points.length));
      const depth = slice.reduce((sum, point) => sum + point.depth, 0) / slice.length;
      const away = (depth - nearest) / span;
      strokeArc(slice, .86 * (1 - away * .66));
    }
  }

  function drawEarthFocus(now) {
    const earth = planets.find(planet => planet.name === "Earth");
    const baseView = state.zenBaseView || state.earthFocusView;
    const driftX = (view().sunX - baseView.sunX) * state.width * .65;
    const driftY = (view().sunY - baseView.sunY) * state.height * .65;
    const zoomBreath = clamp(view().zoom / baseView.zoom, .96, 1.04);
    const radius = clamp(Math.min(state.width, state.height) * .19, 76, 190) * zoomBreath;
    const center = {
      x: state.width * .5 + driftX,
      y: state.height * .51 + driftY
    };

    const moonVector = earthFocusMoonVector(now);
    const moonDirection = earthFocusMoonDirection(now, moonVector);
    const moonDistance = radius * 2.18;
    const moon = {
      x: center.x + dot(moonDirection, state.basis.right) * moonDistance,
      y: center.y - dot(moonDirection, state.basis.up) * moonDistance,
      depth: -dot(moonDirection, state.basis.toward),
      radius: radius * .273
    };

    state.orbitOccluders = [
      { x: center.x, y: center.y, radius },
      { x: moon.x, y: moon.y, radius: moon.radius }
    ];
    if (state.orbits && state.earthLightingMode !== "demo") drawEarthFocusMoonOrbit(center, moonDistance);

    const earthAxis = state.axes.get("Earth");
    const earthPole = projectedAxis(earthAxis);
    const moonPole = projectedAxis(state.moonAxis);
    let earthLongitudeSign = 1;
    let moonLongitudeSign = 1;
    if (state.zenMode === "dream") {
      earthPole.spin = zenSpin("Earth", earthPole.spin, now);
      moonPole.spin = zenSpin("Moon", moonPole.spin, now);
    } else {
      const earthFacing = cameraFacingTexture(earthAxis);
      const moonFacing = cameraFacingTexture(state.moonAxis);
      earthPole.spin = earthFacing.rotation;
      moonPole.spin = moonFacing.rotation;
      earthLongitudeSign = earthFacing.longitudeSign;
      moonLongitudeSign = moonFacing.longitudeSign;
    }
    const sunVector = earthFocusSunVector();
    const moonSunVector = {
      x: sunVector.x - moonVector.x,
      y: sunVector.y - moonVector.y,
      z: sunVector.z - moonVector.z
    };
    const earthLight = screenLight(sunVector);
    const moonLight = screenLight(moonSunVector);
    const earthBody = { x: center.x, y: center.y, radius };
    const moonBody = { x: moon.x, y: moon.y, radius: moon.radius };

    const paintEarth = () => {
      drawTexturedSphere(state.images.get("Earth"), center.x, center.y, radius, earthPole.spin, false, earthLight, earthPole.angle, earthLongitudeSign, true);
      drawPhysicalLighting(center.x, center.y, radius, sunVector, "Earth");
      if (state.earthLightingMode !== "off") drawSolarEclipseShadow(earthBody, moonVector, sunVector);
      if (state.labels) drawLabel("Earth", center.x, center.y, radius);
    };
    const paintMoon = () => {
      drawTexturedSphere(state.images.get("Moon"), moon.x, moon.y, moon.radius, moonPole.spin, false, moonLight, moonPole.angle, moonLongitudeSign, true);
      drawPhysicalLighting(moon.x, moon.y, moon.radius, moonSunVector, "Moon");
      if (state.earthLightingMode !== "off") drawLunarEclipseShadow(moonBody, moonVector, sunVector);
      if (state.labels) drawLabel("Moon", moon.x, moon.y, moon.radius);
    };

    if (moon.depth > 0) paintMoon();
    paintEarth();
    if (moon.depth <= 0) paintMoon();
  }

  function render(now) {
    requestAnimationFrame(render);

    // Suspended by the host — the wallpaper is completely covered, the screen
    // is locked, or the displays are asleep. The loop keeps ticking so it can
    // resume instantly, but does no work at all.
    if (state.renderingSuspended) return;
    if (host.autoZen && !state.zenMode && !reducedMotion && now - state.lastInteraction >= 45000) {
      enterZen(state.zenSelection);
    }
    // Accelerated time and dragging both produce real motion; real-time
    // playback does not. Spend frames only where they show.
    const moving = state.speedIndex > 0 || now - state.lastInteraction < 2000;
    const frameRate = state.zenMode ? host.zenFrameRate
                    : moving ? host.activeFrameRate
                    : host.frameRate;
    // Rate cap, with a tolerance of half a tick.
    //
    // A bare `elapsed < 1000 / frameRate` test aliases badly whenever the
    // requested interval lands near the compositor's own cadence: a tick that
    // misses the threshold by a fraction of a millisecond is discarded, the
    // next one arrives a full interval later, and the delivered rate halves.
    // That is why asking for 30 used to paint fewer frames than asking for 20.
    // Letting a tick through when it is closer to the target than the next one
    // would be removes the beat and delivers min(requested, display rate).
    const tick = now - state.lastTick;
    state.lastTick = now;
    state.rafTicks++;
    if (tick > 0 && tick < 200) {
      state.tickInterval = state.tickInterval ? state.tickInterval * .9 + tick * .1 : tick;
    }
    const tolerance = (state.tickInterval || 16.7) / 2;
    if (now - state.lastFrame < 1000 / frameRate - tolerance) return;
    state.lastFrame = now;
    updateZenCamera(now);
    const dateMs = simulatedTime(now);
    updateTimeReadout(dateMs, now);
    const ephemerisInterval = state.zenMode === "astronomical" ? 1000 / 24 : SPEEDS[state.speedIndex].refresh;
    if (!state.lastEphemeris || (!state.paused && now - state.lastEphemeris >= ephemerisInterval)) {
      updateEphemeris(new Date(dateMs), now);
    }

    const elapsed = elapsedTime(now);

    if (state.earthFocus) {
      state.renderedFrames++;
      ctx.clearRect(0, 0, state.width, state.height);
      drawTwinkles(elapsed);
      drawEarthFocus(now);
      return;
    }

    // Scene cache.
    //
    // At real-time speed the ephemeris refreshes once a minute and the camera
    // is still, so roughly 600 consecutive frames paint an identical picture —
    // 240 stroked orbit arcs, the belt debris, eight textured spheres, the
    // rings and the Moon, all rebuilt from scratch each time. Measurement
    // showed the cost is dominated by that draw-call count rather than by
    // pixel fill, which is exactly the shape of work a cache fixes.
    //
    // The scene goes into an offscreen buffer and is reused until something it
    // depends on changes, or until it goes stale enough that the Sun's shimmer
    // would visibly freeze. Twinkles stay live on the main canvas underneath,
    // which is where they were drawn anyway.
    if (state.sceneCtx) {
      const signature = sceneSignature();
      const stale = now - state.sceneStamp >= host.sceneInterval;
      const dirty = signature !== state.sceneSignature || stale;

      if (dirty) {
        const main = ctx;
        ctx = state.sceneCtx;
        ctx.clearRect(0, 0, state.width, state.height);
        if (!state.zenMode) drawTwinkles(elapsed);
        paintSolarSystem(now, elapsed);
        ctx = main;

        state.sceneSignature = signature;
        state.sceneStamp = now;
        state.sceneRepaints++;
      }

      if (state.zenMode) {
        state.renderedFrames++;
        ctx.clearRect(0, 0, state.width, state.height);
        drawTwinkles(elapsed);
        ctx.drawImage(state.sceneBuffer, 0, 0, state.width, state.height);
        return;
      }

      if (dirty) {
        state.renderedFrames++;
        ctx.clearRect(0, 0, state.width, state.height);
        ctx.drawImage(state.sceneBuffer, 0, 0, state.width, state.height);
      }
      return;
    }

    state.renderedFrames++;
    ctx.clearRect(0, 0, state.width, state.height);
    drawTwinkles(elapsed);
    paintSolarSystem(now, elapsed);
  }

  /// Everything the cached scene depends on. Comparing a signature avoids
  /// having to remember to invalidate at every call site that can move the
  /// camera, change the date or flip a toggle — a missed one would show up as
  /// a wallpaper that silently stops updating.
  function sceneSignature() {
    const v = view();
    const zen = state.zenMode;

    // Zen quantisation.
    //
    // The breathing oscillates over 59-137 second periods, so the scene drifts
    // by only a pixel or two a second. Rounding the camera to a step just under
    // one pixel of on-screen motion therefore costs nothing visible, while
    // collapsing what was a repaint every frame into roughly two a second:
    // each parameter only crosses a quantum boundary a few dozen times per
    // oscillation. Coarser steps were tried and judder became visible — an
    // azimuth quantum of 1 degree moves an outer planet about seven pixels.
    const q = zen
      ? (x, step) => (Math.round(x / step) * step).toFixed(4)
      : (x) => x;
    return [
      state.lastEphemeris, state.width, state.height, state.dpr,
      q(v.elevation, 0.15), q(v.azimuth, 0.15), q(v.roll || 0, 0.1),
      q(v.sunX, 0.0015), q(v.sunY, 0.0015),
      q(v.zoom, 0.002), v.bodies, v.distance || 0,
      state.labels ? 1 : 0, state.orbits ? 1 : 0,
      zen || "",
      // Dream is the one mode that genuinely moves the planets every frame, so
      // it cannot be quantised by camera alone. Mercury, the fastest, covers
      // about ten pixels a second, making a 100ms step a one-pixel advance.
      zen === "dream" ? Math.floor(performance.now() / 100) : 0
    ].join(",");
  }

  function paintSolarSystem(now, elapsed) {
    // Build screen-space body bounds before any orbit is painted. strokeArc
    // uses these bounds as cut-outs, including when an arc is depth-sorted in
    // front of a body.
    const scale = Math.max(.72, Math.min(1.28, Math.min(state.width, state.height) / 820)) * view().bodies;
    const bodyLayout = planets.map(planet => {
      const point = project(displayVector(planet, now));
      let radius = planet.radius * scale * point.size;
      if (planet.name === "Earth") radius *= 1.18;
      if (planet.name === "Jupiter") radius *= .92;
      return { planet, point, radius, pole: projectedPole(planet, now) };
    });
    const sunResponsive = Math.max(0.72, Math.min(1.25, Math.min(state.width, state.height) / 820));
    state.orbitOccluders = [
      {
        x: state.width * view().sunX,
        y: state.height * view().sunY,
        radius: 66 * sunResponsive * view().bodies * 1.35
      },
      ...bodyLayout.map(({ point, radius }) => ({ x: point.x, y: point.y, radius }))
    ];

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

    for (const { planet, point, radius, pole } of bodyLayout) {
      drawables.push({
        depth: point.depth,
        draw: () => {
          if (planet.rings) drawSaturnRings(point.x, point.y, radius, pole, false);
          const light = lightDirection(point.x, point.y);
          drawTexturedSphere(state.images.get(planet.name), point.x, point.y, radius, pole.spin, false, light, pole.angle);
          if (planet.rings) drawSaturnRings(point.x, point.y, radius, pole, true);
          if (state.labels) drawLabel(planet.name, point.x, point.y, radius);
        }
      });
      if (planet.name === "Earth") collectMoonSystem(point, radius, now, drawables);
    }

    // Farthest first, so nearer things paint over them.
    drawables.sort((a, b) => b.depth - a.depth);
    for (const item of drawables) item.draw();
  }

  function togglePause() {
    const now = performance.now();
    if (state.paused) {
      state.timeRealAnchor = now;
      state.startTime = now;
      state.paused = false;
    } else {
      state.timeAnchor = simulatedTime(now);
      state.timeRealAnchor = now;
      state.frozenElapsed = elapsedTime(now);
      state.paused = true;
    }
    state.lastEphemeris = 0;
    updateTransportUi();
    updateTimeReadout(state.timeAnchor, now, true);
    describeView();
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
    if (state.zenMode) { exitZen(); return; }
    drag.active = true;
    drag.mode = dragMode(event);
    drag.x = event.clientX;
    drag.y = event.clientY;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* pen/touch quirks */ }
    if (camera.hidden) { camera.hidden = false; updateReadout(); }
  });

  canvas.addEventListener("pointermove", event => {
    if (state.zenMode) { exitZen(); return; }
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
    if (state.zenMode) { exitZen(); return; }
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

  reverseTime.addEventListener("click", () => setTimeDirection(-1));
  pauseTime.addEventListener("click", togglePause);
  forwardTime.addEventListener("click", () => setTimeDirection(1));
  today.addEventListener("click", returnToToday);
  earthFocus.addEventListener("click", () => setEarthFocus());
  earthLightingMode.addEventListener("change", () => setEarthLighting(earthLightingMode.value));
  for (const button of speedControls) {
    button.addEventListener("click", () => setSimulationSpeed(Number(button.dataset.speed)));
  }
  zenModeSelect.addEventListener("change", () => { state.zenSelection = zenModeSelect.value; });
  zenToggle.addEventListener("click", () => state.zenMode ? exitZen() : enterZen(state.zenSelection));

  for (const type of ["pointermove", "pointerdown", "wheel"]) {
    addEventListener(type, () => {
      if (state.zenMode) exitZen();
      else state.lastInteraction = performance.now();
    }, { passive: true });
  }

  addEventListener("resize", resize, { passive: true });
  addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    state.lastInteraction = performance.now();
    if (state.zenMode) {
      if (key === "z") cycleZenMode();
      else if (key === "e") setEarthFocus();
      else if (key === "s" && state.earthFocus) cycleEarthLighting();
      else exitZen();
      event.preventDefault();
      return;
    }
    if (key === "z") { cycleZenMode(); event.preventDefault(); return; }
    if (key === "e") { setEarthFocus(); event.preventDefault(); return; }
    if (key === "s" && state.earthFocus) { cycleEarthLighting(); event.preventDefault(); return; }
    if (event.code === "Space") { event.preventDefault(); togglePause(); }
    if (key === "l") state.labels = !state.labels;
    if (key === "o") state.orbits = !state.orbits;
    if (key === "h") help.hidden = !help.hidden;
    if (key === "p") positions.hidden = !positions.hidden;
    if (key === "t") returnToToday();
    if (key === "[") setSimulationSpeed(state.speedIndex - 1);
    if (key === "]") setSimulationSpeed(state.speedIndex + 1);
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

  // Command surface for the native macOS host.
  //
  // The wallpaper window deliberately ignores mouse and keyboard events, so
  // that desktop icons stay clickable. That leaves the control bar and every
  // keyboard shortcut unreachable, and this is how they are handed back: the
  // host drives the same functions the buttons call, and polls stats() for a
  // readout. It is inert in a browser tab.
  window.WallpaperBridge = {
    config: host,

    /// Frames actually painted since the last call, plus what is on screen.
    /// Counting rendered frames rather than requestAnimationFrame ticks is
    /// the only honest measure once the loop is rate-capped.
    stats() {
      const frames = state.renderedFrames;
      const repaints = state.sceneRepaints;
      const ticks = state.rafTicks;
      state.renderedFrames = 0;
      state.sceneRepaints = 0;
      state.rafTicks = 0;
      return {
        frames,
        repaints,
        ticks,
        suspended: state.renderingSuspended,
        date: simDate.textContent,
        zen: state.zenMode,
        paused: state.paused,
        earthFocus: state.earthFocus,
        earthLighting: state.earthLightingMode,
        speed: SPEEDS[state.speedIndex].label,
        viewIndex: state.viewIndex,
        viewName: view().name,
        labels: state.labels,
        orbits: state.orbits
      };
    },

    views: () => VIEWS.map((entry, index) => ({ index, name: entry.name })),
    zenModes: () => ZEN_MODES.map(mode => ({ mode, label: ZEN_LABELS[mode] })),
    speeds: () => SPEEDS.map((entry, index) => ({ index, label: entry.label })),

    setSpeed: index => setSimulationSpeed(index),
    setDirection: direction => setTimeDirection(direction),
    togglePause: () => togglePause(),
    today: () => returnToToday(),

    setView: index => applyView(index),
    cycleView: () => applyView((state.viewIndex + 1) % VIEWS.length),
    resetView: () => applyView(),
    presetLine: () => presetLine(),

    setEarthFocus: on => setEarthFocus(on),
    setEarthLighting: mode => setEarthLighting(mode),
    /// `fps` lets the host pick a rate per trigger: a hand-started animation
    /// is being watched deliberately and deserves smooth motion, an idle one
    /// is running to an empty room. The scene cache does reach Zen — the
    /// camera is quantised in sceneSignature — so the rate is cheap to raise.
    setZen: (mode, fps) => {
      if (typeof fps === "number" && fps > 0) host.zenFrameRate = fps;
      mode ? enterZen(mode) : exitZen();
    },
    setLabels: on => { state.labels = !!on; },
    setOrbits: on => { state.orbits = !!on; },

    /// Stop or restart painting entirely. Used when the desktop is fully
    /// covered, locked or asleep — nothing is visible, so nothing should be
    /// drawn. Resuming forces a fresh ephemeris and a full repaint, because
    /// arbitrary time may have passed while suspended.
    setRendering(on) {
      state.renderingSuspended = !on;
      if (on) {
        state.sceneSignature = null;
        state.lastEphemeris = 0;
      }
      return !state.renderingSuspended;
    },

    /// Show or hide the page's own chrome without a reload.
    setChrome(visible) {
      document.body.dataset.mode = visible ? "" : "wallpaper";
    },

    /// Everything needed to reproduce the current composition somewhere else.
    /// Both camera objects are captured, not just the active one, so moving a
    /// scene between windows does not silently discard the other framing.
    snapshot() {
      const clone = source => (source ? Object.assign({}, source) : null);
      return {
        viewIndex: state.viewIndex,
        live: clone(state.live),
        earthFocusView: clone(state.earthFocusView),
        earthFocus: state.earthFocus,
        earthLighting: state.earthLightingMode,
        labels: state.labels,
        orbits: state.orbits,
        speedIndex: state.speedIndex
      };
    },

    /// Inverse of snapshot(). Zen is deliberately not restored — it is a
    /// presentation state, not part of a composition.
    apply(snap) {
      if (!snap) return false;

      // setEarthFocus(true) resets earthFocusView to the built-in default, so
      // it has to run before the saved cameras are written back.
      if (typeof snap.earthFocus === "boolean") setEarthFocus(snap.earthFocus);

      // applyView loads VIEWS[index] into state.live, so a snapshot carrying
      // only an index still produces the right camera rather than leaving the
      // index and the live camera describing different things.
      if (typeof snap.viewIndex === "number") applyView(snap.viewIndex);
      if (snap.live) state.live = Object.assign({}, snap.live);
      if (snap.earthFocusView) state.earthFocusView = Object.assign({}, snap.earthFocusView);
      if (typeof snap.labels === "boolean") state.labels = snap.labels;
      if (typeof snap.orbits === "boolean") state.orbits = snap.orbits;
      if (typeof snap.speedIndex === "number") setSimulationSpeed(snap.speedIndex);
      if (typeof snap.earthLighting === "string") setEarthLighting(snap.earthLighting);

      refreshCamera();
      return true;
    }
  };

  async function init() {
    if (host.wallpaper) document.body.dataset.mode = "wallpaper";
    resize();
    try {
      await loadAssets();
      initializePositionPanel();
      updateTransportUi();
      applyView();
      const now = performance.now();
      const dateMs = simulatedTime(now);
      updateTimeReadout(dateMs, now, true);
      updateEphemeris(new Date(dateMs), now);
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
