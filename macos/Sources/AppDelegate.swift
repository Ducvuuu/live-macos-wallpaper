import Cocoa
import ServiceManagement

/// Menu-bar-only host for the live-macos-wallpaper web app.
///
/// The web app is loaded from its own repo, in place. Nothing is copied or
/// bundled, so editing app.js there updates the live wallpaper.
final class AppDelegate: NSObject, NSApplicationDelegate {

    static let defaultWebDirectory = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent("Documents/GitHub/live-macos-wallpaper")

    private var webDirectory = defaultWebDirectory
    private var surfaces: [WallpaperSurface] = []
    private var statusItem: NSStatusItem!

    private var dprCap = 1.0
    private var frameRate = 10
    private var sceneInterval = 500
    /// A hand-started animation is being watched on purpose, so it gets a
    /// proper frame rate. An idle one is playing to an empty room.
    private var zenFrameRate = 30
    private var idleZenFrameRate = 18
    private var chromeVisible = false

    private var watchTimer: DispatchSourceTimer?
    private let watchQueue = DispatchQueue(label: "solarwallpaper.watch", qos: .utility)
    private var statsTimer: Timer?
    private var lastSignature = ""
    private var activity: NSObjectProtocol?
    private var builtDynamicMenu = false
    private var studio: StudioWindowController?
    private var screenFingerprint = ""

    // MARK: Idle animation
    //
    // The page's own 45-second idle timer is useless on the desktop layer: the
    // window never receives a pointer or key event, so "idle" would latch on
    // immediately and never release. Real idleness is a property of the
    // machine, not the window, so it is measured here and pushed in.
    private var idleTimer: Timer?
    private var idleThreshold: TimeInterval = 120
    private var idleZenMode = "astronomical"
    /// True only while Zen is running *because* the machine went idle. Zen
    /// chosen by hand from the menu is left alone by the idle logic.
    private var zenFromIdle = false
    private var screensAsleep = false

    // MARK: Energy gating
    private var occlusionTimer: Timer?
    /// Off by default: the window-list coverage test produced too many false
    /// positives in practice, pausing the wallpaper while it was plainly
    /// visible. Sleep and lock gating are unaffected — those are reliable.
    /// The menu toggle remains for anyone who wants to try it.
    private var pauseWhenCovered = false
    private var screenLocked = false
    /// Disables all automatic suspend (occlusion, lock, display sleep).
    private var neverSuspend = false

    func applicationDidFinishLaunching(_ note: Notification) {
        Log.start()

        // A menu-bar-only app with no visible windows is a prime App Nap
        // target, and App Nap coalesces timers into oblivion — the WebViews
        // never finish loading and nothing is logged. Opt out, but still let
        // the Mac itself sleep when idle.
        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep],
            reason: "Rendering the live desktop wallpaper")

        let env = ProcessInfo.processInfo.environment
        if let override = env["SOLAR_WALLPAPER_WEB_DIR"] {
            webDirectory = URL(fileURLWithPath: override)
        }
        dprCap = Double(env["SOLAR_WALLPAPER_DPR"] ?? "") ?? 1.0
        frameRate = Int(env["SOLAR_WALLPAPER_FPS"] ?? "") ?? 10
        sceneInterval = Int(env["SOLAR_WALLPAPER_SCENE"] ?? "") ?? 500
        // Zen used to collapse above ~20 fps, which looked like a GPU ceiling
        // but was the page's own rate cap aliasing against a 60 Hz compositor.
        // With that fixed and the scene cache reaching Zen, measured output is
        // ~47 fps at 45 requested, so a hand-started animation can have it.
        zenFrameRate = Int(env["SOLAR_WALLPAPER_ZEN_FPS"] ?? "") ?? 45
        idleZenFrameRate = Int(env["SOLAR_WALLPAPER_IDLE_ZEN_FPS"] ?? "") ?? 24
        neverSuspend = env["SOLAR_WALLPAPER_NO_SUSPEND"] == "1"

        Log.write("[config] web=\(webDirectory.path) dpr=\(dprCap) fps=\(frameRate) scene=\(sceneInterval)ms suspend=\(neverSuspend ? "off" : "on")")

        guard FileManager.default.fileExists(atPath: webDirectory.appendingPathComponent("index.html").path) else {
            presentMissingWebApp()
            return
        }

        buildStatusItem()
        screenFingerprint = NSScreen.screens.map { "\($0.localizedName)|\($0.frame)" }.joined(separator: ";")
        rebuildSurfaces()

        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)

        startWatchingSource()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.refreshStats()
        }

        // Login item can also be driven from the environment, which is how it
        // gets verified without clicking a menu.
        switch env["SOLAR_WALLPAPER_LOGIN"] {
        case "on":  try? SMAppService.mainApp.register()
        case "off": try? SMAppService.mainApp.unregister()
        default: break
        }
        Log.write("[login] start at login: \(describe(SMAppService.mainApp.status))")

        loadIdleSettings()
        if let override = Double(env["SOLAR_WALLPAPER_IDLE"] ?? "") { idleThreshold = override }
        idleTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkIdle()
        }

        if UserDefaults.standard.object(forKey: "pauseWhenCovered") != nil {
            pauseWhenCovered = UserDefaults.standard.bool(forKey: "pauseWhenCovered")
        }
        occlusionTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.checkOcclusion()
        }

        // Screen lock is not a workspace notification; it arrives on the
        // distributed centre. Available because this app is not sandboxed.
        let distributed = DistributedNotificationCenter.default()
        distributed.addObserver(self, selector: #selector(screenLockedChanged(_:)),
                                name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        distributed.addObserver(self, selector: #selector(screenLockedChanged(_:)),
                                name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)

        // Rendering an idle animation onto a sleeping display is pure waste.
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(screensSlept),
                              name: NSWorkspace.screensDidSleepNotification, object: nil)
        workspace.addObserver(self, selector: #selector(screensWoke),
                              name: NSWorkspace.screensDidWakeNotification, object: nil)

        // Starts an animation at launch, so its real painted rate shows up in
        // the ordinary [stats] line without any menu clicking.
        if let mode = env["SOLAR_WALLPAPER_ZEN"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                if env["SOLAR_WALLPAPER_ZEN_ORBITS"] == "0" {
                    self.surfaces.forEach { $0.command("setOrbits(false)") }
                }
                self.surfaces.forEach { $0.command("setZen('\(mode)', \(self.zenFrameRate))") }
                Log.write("[zen] started \(mode) at \(self.zenFrameRate) fps")
                // Drive the studio too, so a normal window and the desktop
                // windows can be compared side by side on the same machine.
                self.studio?.evaluate("WallpaperBridge.setZen('\(mode)', \(self.zenFrameRate))")
                Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
                    self.studio?.logFrameRate()
                }
            }
        }

        if env["SOLAR_WALLPAPER_STUDIO"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.openStudio() }
        }
    }

    func applicationWillTerminate(_ note: Notification) {
        Log.write("[stop] terminating")
    }

    // MARK: - Surfaces

    private func rebuildSurfaces() {
        surfaces.forEach { $0.window.orderOut(nil) }
        let mainOnly = ProcessInfo.processInfo.environment["SOLAR_WALLPAPER_MAIN_ONLY"] == "1"
        let screens = mainOnly ? [NSScreen.main].compactMap { $0 } : NSScreen.screens

        surfaces = screens.enumerated().map { index, screen in
            WallpaperSurface(screen: screen, webDirectory: webDirectory,
                             index: index, dprCap: dprCap, frameRate: frameRate,
                             sceneInterval: sceneInterval, zenFrameRate: zenFrameRate)
        }
        Log.write("[screens] \(surfaces.count): \(surfaces.map(\.displayName).joined(separator: ", "))")
    }

    @objc private func screensChanged() {
        let screens = NSScreen.screens
        let newFingerprint = screens.map { "\($0.localizedName)|\($0.frame)" }.joined(separator: ";")
        guard newFingerprint != screenFingerprint else {
            Log.write("[screens] notification fired but nothing changed — ignoring")
            return
        }
        screenFingerprint = newFingerprint
        Log.write("[screens] configuration changed — rebuilding")
        rebuildSurfaces()
    }

    /// Reloads every display and rebuilds the menu from the page's own data.
    ///
    /// The rebuild matters: framings, speeds and Zen modes are read out of
    /// app.js, so adding a preset to VIEWS must make it appear in the menu
    /// without touching any Swift. Without resetting this flag the menu was
    /// built once at launch and went stale on every live reload.
    private func reloadEverything() {
        builtDynamicMenu = false
        surfaces.forEach { $0.reload() }
    }

    /// Every command goes to all displays, so the two screens stay in step.
    private func broadcast(_ expression: String) {
        Log.write("[menu] \(expression)")
        surfaces.forEach { $0.command(expression) }
    }

    // MARK: - Live reload

    /// Deliberately a bare stat(2) rather than FileManager.attributesOfItem.
    ///
    /// attributesOfItem also fetches extended attributes, and getxattr can
    /// block indefinitely on a cloud-synced folder — which ~/Documents often
    /// is. Running that on the main thread hung the whole app at launch: no
    /// timers, no WebKit callbacks, no window, and nothing in the log after
    /// "[screens]". stat() touches none of that.
    private func sourceSignature() -> String {
        var parts: [String] = []
        for name in ["index.html", "app.js", "styles.css"] {
            let path = webDirectory.appendingPathComponent(name).path
            var info = stat()
            if stat(path, &info) == 0 {
                parts.append("\(name):\(info.st_mtimespec.tv_sec).\(info.st_mtimespec.tv_nsec):\(info.st_size)")
            } else {
                parts.append("\(name):missing")
            }
        }
        return parts.joined(separator: "|")
    }

    /// Polling runs on its own queue and only hops to main when something
    /// actually changed, so a slow filesystem can never stall the UI.
    private func startWatchingSource() {
        watchQueue.async {
            self.lastSignature = self.sourceSignature()
        }
        let timer = DispatchSource.makeTimerSource(queue: watchQueue)
        timer.schedule(deadline: .now() + 1.5, repeating: 1.5)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let signature = self.sourceSignature()
            guard signature != self.lastSignature else { return }
            self.lastSignature = signature
            DispatchQueue.main.async {
                Log.write("[watch] source changed — reloading")
                self.reloadEverything()
            }
        }
        timer.resume()
        watchTimer = timer
    }

    private func describe(_ status: SMAppService.Status) -> String {
        switch status {
        case .enabled: return "enabled"
        case .notRegistered: return "not registered"
        case .notFound: return "not found"
        case .requiresApproval: return "needs approval in System Settings > General > Login Items"
        @unknown default: return "unknown"
        }
    }

    // MARK: - Idle animation

    private func loadIdleSettings() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "idleThreshold") != nil {
            idleThreshold = defaults.double(forKey: "idleThreshold")
        }
        idleZenMode = defaults.string(forKey: "idleZenMode") ?? "astronomical"
        Log.write("[idle] after \(Int(idleThreshold))s → \(idleZenMode)")
    }

    private func saveIdleSettings() {
        UserDefaults.standard.set(idleThreshold, forKey: "idleThreshold")
        UserDefaults.standard.set(idleZenMode, forKey: "idleZenMode")
    }

    /// Seconds since the last human input anywhere on the machine.
    ///
    /// Each event type carries its own timestamp, so the most recent activity
    /// is the smallest of them. There is a "any input" constant, but its raw
    /// value is not a defined CGEventType case and the failable initialiser
    /// can reject it, so the types are listed explicitly instead.
    private func systemIdleSeconds() -> TimeInterval {
        let types: [CGEventType] = [
            .mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .keyDown, .flagsChanged, .scrollWheel
        ]
        return types
            .map { CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: $0) }
            .min() ?? 0
    }

    private func checkIdle() {
        guard !screensAsleep, idleThreshold > 0 else { return }
        let idle = systemIdleSeconds()

        if idle >= idleThreshold, !zenFromIdle, currentZenMode == nil {
            zenFromIdle = true
            Log.write("[idle] \(Int(idle))s idle — starting \(idleZenMode) at \(idleZenFrameRate) fps")
            surfaces.forEach { $0.command("setZen('\(idleZenMode)', \(idleZenFrameRate))") }
        } else if idle < idleThreshold, zenFromIdle {
            zenFromIdle = false
            Log.write("[idle] activity — leaving idle animation")
            surfaces.forEach { $0.command("setZen(null)") }
            surfaces.forEach { $0.command("today()") }
        }
    }

    private var currentZenMode: String? {
        surfaces.first?.stats["zen"] as? String
    }

    @objc private func screensSlept() {
        screensAsleep = true
        if zenFromIdle {
            zenFromIdle = false
            surfaces.forEach { $0.command("setZen(null)") }
        }
        if !neverSuspend {
            surfaces.forEach { $0.setRendering(false, reason: "displays asleep") }
        }
    }

    @objc private func screensWoke() {
        screensAsleep = false
        surfaces.forEach { $0.setRendering(true, reason: "displays awake") }
        surfaces.forEach { $0.command("today()") }
    }

    @objc private func screenLockedChanged(_ note: Notification) {
        screenLocked = note.name.rawValue == "com.apple.screenIsLocked"
        Log.write("[power] screen \(screenLocked ? "locked" : "unlocked")\(neverSuspend ? " (suspend disabled)" : "")")
        if neverSuspend { return }
        if screenLocked {
            surfaces.forEach { $0.setRendering(false, reason: "screen locked") }
        } else {
            surfaces.forEach { $0.setRendering(true, reason: "screen unlocked") }
            surfaces.forEach { $0.command("today()") }
        }
    }

    // MARK: - Occlusion

    /// Pause any display whose wallpaper is entirely hidden behind other
    /// applications. A full-screen browser or editor is the common case, and
    /// it costs nothing to notice.
    private func checkOcclusion() {
        guard !neverSuspend, !screensAsleep, !screenLocked else { return }
        guard pauseWhenCovered else {
            surfaces.forEach { $0.setRendering(true) }
            return
        }
        let pid = ProcessInfo.processInfo.processIdentifier
        for surface in surfaces {
            let covered = Occlusion.coverage(of: surface.screenFrame, excluding: pid) >= 0.95
            surface.setRendering(!covered, reason: covered ? "covered" : "exposed")
        }
    }

    /// Registers the app itself as a login item. SMAppService needs a stable
    /// path to point at, which is why the app installs to /Applications rather
    /// than running out of the build workspace.
    @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
                Log.write("[login] disabled")
            } else {
                try service.register()
                Log.write("[login] enabled")
            }
        } catch {
            Log.write("[login] failed: \(error.localizedDescription)")
            let alert = NSAlert()
            alert.messageText = "Could not change the login item"
            alert.informativeText = error.localizedDescription
                + "\n\nThis usually means the app is not in /Applications."
            alert.runModal()
        }
        sender.state = service.status == .enabled ? .on : .off
    }

    @objc private func togglePauseWhenCovered(_ sender: NSMenuItem) {
        pauseWhenCovered.toggle()
        UserDefaults.standard.set(pauseWhenCovered, forKey: "pauseWhenCovered")
        sender.state = pauseWhenCovered ? .on : .off
        Log.write("[power] pause when covered: \(pauseWhenCovered)")
        if !pauseWhenCovered { surfaces.forEach { $0.setRendering(true) } }
    }

    // MARK: - Stats

    private func refreshStats() {
        for surface in surfaces { surface.refreshStats() }
        guard let first = surfaces.first else { return }

        if !builtDynamicMenu, first.isLoaded { buildDynamicMenu(from: first) }

        let stats = first.stats
        let fps = first.paintedFPS
        let date = stats["date"] as? String ?? "—"
        let zen = stats["zen"] as? String
        Log.write(String(format: "[stats] %.1f fps · %.1f repaints/s · idle %.0fs · zen=%@%@ · %@",
                         fps, first.repaintsPerSecond, systemIdleSeconds(),
                         zen ?? "off", zenFromIdle ? " (auto)" : "", date)
                  + (first.isSuspended ? "  [PAUSED]" : ""))
        updateMenuState()
    }

    // MARK: - Status item

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let iconURL = Bundle.main.url(forResource: "MenuBarIconTemplate", withExtension: "pdf"),
           let icon = NSImage(contentsOf: iconURL) {
            icon.isTemplate = true
            icon.size = NSSize(width: 18, height: 18)
            statusItem.button?.image = icon
            statusItem.button?.imagePosition = .imageOnly
            statusItem.button?.setAccessibilityLabel("Solar Wallpaper")
        }
        statusItem.menu = NSMenu()
        rebuildMenu(views: [], speeds: [], zenModes: [])
    }

    /// Views, speeds and Zen modes are defined in app.js, so the menu is built
    /// from whatever the page reports rather than duplicating the lists here.
    private func buildDynamicMenu(from surface: WallpaperSurface) {
        builtDynamicMenu = true
        surface.query("views()") { views in
            surface.query("speeds()") { speeds in
                surface.query("zenModes()") { zen in
                    self.rebuildMenu(views: views as? [[String: Any]] ?? [],
                                     speeds: speeds as? [[String: Any]] ?? [],
                                     zenModes: zen as? [[String: Any]] ?? [])
                    Log.write("[menu] built: \((views as? [Any] ?? []).count) views, "
                              + "\((speeds as? [Any] ?? []).count) speeds, "
                              + "\((zen as? [Any] ?? []).count) zen modes")
                    let mode = ProcessInfo.processInfo.environment["SOLAR_WALLPAPER_SELFTEST"]
                    if mode == "1" || mode == "bridge" { self.runSelfTest() }
                    if mode == "zen" { self.runZenTest() }
                }
            }
        }
    }

    /// Drives the write half of the bridge and reports what changed. The
    /// wallpaper cannot be clicked, so this is the only way to check that
    /// commands land without going through the menu by hand.
    /// Measures what a Zen frame-rate request actually delivers. Asking for
    /// more than the machine can paint makes output collapse, not improve.
    private func runZenTest() {
        guard let surface = surfaces.first else { return }
        let rates = [15, 20, 24, 30, 45, 60]
        var index = 0
        func next() {
            guard index < rates.count else {
                surface.command("setZen(null)")
                Log.write("[zentest] done")
                return
            }
            let rate = rates[index]; index += 1
            surfaces.forEach { $0.command("setZen('ambient', \(rate))") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                surface.refreshStats {
                    let gpu = ProcessInfo.processInfo.thermalState == .nominal ? "nominal" : "warm"
                    Log.write(String(format: "[zentest] asked %d fps -> painted %.1f  (raf %.1f, repaints %.1f/s, thermal %@)",
                                     rate, surface.paintedFPS, surface.tickFPS,
                                     surface.repaintsPerSecond, gpu))
                    next()
                }
            }
        }
        next()
    }

    private func runSelfTest() {
        guard let surface = surfaces.first else { return }
        let steps: [(String, String)] = [
            ("setEarthFocus(true)", "earthFocus"),
            ("setEarthFocus(false)", "earthFocus"),
            ("setLabels(true)", "labels"),
            ("setView(2)", "viewName"),
            ("setSpeed(2)", "speed"),
            ("setSpeed(0)", "speed"),
            ("setZen('ambient')", "zen"),
            ("setZen(null)", "zen"),
            ("setView(0)", "viewName")
        ]
        var index = 0
        func next() {
            guard index < steps.count else { Log.write("[selftest] done"); return }
            let (command, key) = steps[index]
            index += 1
            surface.command(command)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                surface.refreshStats {
                    let value = surface.stats[key].map { "\($0)" } ?? "nil"
                    Log.write("[selftest] \(command) -> \(key)=\(value)")
                    next()
                }
            }
        }
        next()
    }

    /// Proves the studio round-trip: change the composition in the studio,
    /// press Apply, and confirm the desktop actually took it.
    private func runStudioTest() {
        guard let studio, studio.ready, let surface = surfaces.first else {
            Log.write("[studiotest] studio not ready")
            return
        }
        studio.evaluate("WallpaperBridge.apply({viewIndex:3, labels:true, orbits:false})") { _ in
            studio.evaluate("WallpaperBridge.snapshot()") { value in
                Log.write("[studiotest] studio composed: \(self.describe(value))")
                studio.applyToDesktop()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    surface.query("snapshot()") { desktop in
                        Log.write("[studiotest] desktop now:    \(self.describe(desktop))")
                        Log.write("[studiotest] done")
                    }
                }
            }
        }
    }

    /// Pulls the few fields the round-trip test actually asserts on.
    private func describe(_ value: Any?) -> String {
        guard let dict = value as? [String: Any] else { return "unreadable" }
        let view = (dict["live"] as? [String: Any])?["name"] as? String ?? "?"
        let elevation = (dict["live"] as? [String: Any])?["elevation"] ?? "?"
        return "viewIndex=\(dict["viewIndex"] ?? "?") name=\(view) elevation=\(elevation) "
             + "labels=\(dict["labels"] ?? "?") orbits=\(dict["orbits"] ?? "?")"
    }

    private func rebuildMenu(views: [[String: Any]], speeds: [[String: Any]], zenModes: [[String: Any]]) {
        let menu = NSMenu()
        menu.autoenablesItems = false

        let header = NSMenuItem(title: "Loading…", action: nil, keyEquivalent: "")
        header.isEnabled = false
        header.tag = Tag.header
        menu.addItem(header)

        let dateItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        dateItem.isEnabled = false
        dateItem.tag = Tag.date
        menu.addItem(dateItem)
        menu.addItem(.separator())

        // Framing
        if !views.isEmpty {
            let item = NSMenuItem(title: "Framing", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for entry in views {
                let index = entry["index"] as? Int ?? 0
                let child = NSMenuItem(title: entry["name"] as? String ?? "View \(index)",
                                       action: #selector(pickView(_:)), keyEquivalent: "")
                child.target = self
                child.tag = index
                sub.addItem(child)
            }
            item.submenu = sub
            item.tag = Tag.viewMenu
            menu.addItem(item)
        }

        // Speed
        if !speeds.isEmpty {
            let item = NSMenuItem(title: "Speed", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for entry in speeds {
                let index = entry["index"] as? Int ?? 0
                let child = NSMenuItem(title: entry["label"] as? String ?? "Speed \(index)",
                                       action: #selector(pickSpeed(_:)), keyEquivalent: "")
                child.target = self
                child.tag = index
                sub.addItem(child)
            }
            item.submenu = sub
            item.tag = Tag.speedMenu
            menu.addItem(item)
        }

        menu.addItem(item(title: "Pause", action: #selector(togglePause), tag: Tag.pause))
        menu.addItem(item(title: "Today", action: #selector(today), key: "t"))
        menu.addItem(.separator())

        menu.addItem(item(title: "Earth Focus", action: #selector(toggleEarthFocus), key: "e", tag: Tag.earthFocus))

        let light = NSMenuItem(title: "Earth Light", action: nil, keyEquivalent: "")
        let lightMenu = NSMenu()
        for (mode, label) in [("accurate", "Accurate"), ("demo", "Eclipse demo"), ("off", "Off")] {
            let child = NSMenuItem(title: label, action: #selector(pickLighting(_:)), keyEquivalent: "")
            child.target = self
            child.representedObject = mode
            lightMenu.addItem(child)
        }
        light.submenu = lightMenu
        light.tag = Tag.lightMenu
        menu.addItem(light)

        // Zen
        let zenItem = NSMenuItem(title: "Zen", action: nil, keyEquivalent: "")
        let zenMenu = NSMenu()
        let off = NSMenuItem(title: "Off", action: #selector(pickZen(_:)), keyEquivalent: "")
        off.target = self
        zenMenu.addItem(off)
        for entry in zenModes {
            let child = NSMenuItem(title: entry["label"] as? String ?? "Zen",
                                   action: #selector(pickZen(_:)), keyEquivalent: "")
            child.target = self
            child.representedObject = entry["mode"] as? String
            zenMenu.addItem(child)
        }
        zenItem.submenu = zenMenu
        zenItem.tag = Tag.zenMenu
        zenItem.toolTip = "Start an animation now, and keep it running"
        menu.addItem(zenItem)

        // Idle animation: the same animations, started by the machine going
        // quiet rather than by hand, and stopped by the first input.
        let idleItem = NSMenuItem(title: "Idle Animation", action: nil, keyEquivalent: "")
        let idleMenu = NSMenu()
        for (seconds, label) in [(0.0, "Never"), (60.0, "After 1 minute"), (120.0, "After 2 minutes"),
                                 (300.0, "After 5 minutes"), (600.0, "After 10 minutes")] {
            let child = NSMenuItem(title: label, action: #selector(pickIdleDelay(_:)), keyEquivalent: "")
            child.target = self
            child.representedObject = seconds
            idleMenu.addItem(child)
        }
        idleMenu.addItem(.separator())
        let modeHeader = NSMenuItem(title: "Animation", action: nil, keyEquivalent: "")
        modeHeader.isEnabled = false
        idleMenu.addItem(modeHeader)
        for entry in zenModes {
            let child = NSMenuItem(title: entry["label"] as? String ?? "Zen",
                                   action: #selector(pickIdleMode(_:)), keyEquivalent: "")
            child.target = self
            child.representedObject = entry["mode"] as? String
            idleMenu.addItem(child)
        }
        idleItem.submenu = idleMenu
        idleItem.tag = Tag.idleMenu
        idleItem.toolTip = "Start automatically when the Mac has been untouched"
        menu.addItem(idleItem)

        menu.addItem(item(title: "Labels", action: #selector(toggleLabels), key: "l", tag: Tag.labels))
        menu.addItem(item(title: "Orbit Paths", action: #selector(toggleOrbits), key: "o", tag: Tag.orbits))
        menu.addItem(.separator())

        menu.addItem(item(title: "Start at Login", action: #selector(toggleLaunchAtLogin(_:)), tag: Tag.login))
        menu.addItem(item(title: "Pause When Covered", action: #selector(togglePauseWhenCovered(_:)), tag: Tag.pauseCovered))
        menu.addItem(item(title: "Open Studio…", action: #selector(openStudio), key: "s"))
        menu.addItem(item(title: "Show Controls", action: #selector(toggleChrome), tag: Tag.chrome))
        menu.addItem(item(title: "Copy Camera Preset", action: #selector(copyPreset), key: "c"))
        menu.addItem(item(title: "Reload", action: #selector(reloadAll), key: "r"))
        menu.addItem(item(title: "Open Web Folder", action: #selector(openWebFolder)))
        menu.addItem(item(title: "Open Log", action: #selector(openLog)))
        menu.addItem(.separator())
        menu.addItem(item(title: "Quit", action: #selector(quit), key: "q"))

        statusItem.menu = menu
        updateMenuState()
    }

    private func item(title: String, action: Selector, key: String = "", tag: Int = 0) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
        entry.target = self
        entry.tag = tag
        return entry
    }

    private enum Tag {
        static let header = 900, date = 901, viewMenu = 902, speedMenu = 903
        static let pause = 904, earthFocus = 905, lightMenu = 906, zenMenu = 907
        static let labels = 908, orbits = 909, chrome = 910, idleMenu = 911
        static let pauseCovered = 912, login = 913
    }

    private func updateMenuState() {
        guard let menu = statusItem.menu, let stats = surfaces.first?.stats else { return }
        let fps = surfaces.first?.paintedFPS ?? 0

        menu.item(withTag: Tag.header)?.title =
            String(format: "%.0f fps · %@", fps, stats["viewName"] as? String ?? "—")
        menu.item(withTag: Tag.date)?.title = stats["date"] as? String ?? "—"

        let paused = stats["paused"] as? Bool ?? false
        menu.item(withTag: Tag.pause)?.title = paused ? "Resume" : "Pause"

        menu.item(withTag: Tag.earthFocus)?.state = (stats["earthFocus"] as? Bool ?? false) ? .on : .off
        menu.item(withTag: Tag.labels)?.state = (stats["labels"] as? Bool ?? false) ? .on : .off
        menu.item(withTag: Tag.orbits)?.state = (stats["orbits"] as? Bool ?? false) ? .on : .off
        menu.item(withTag: Tag.chrome)?.state = chromeVisible ? .on : .off
        menu.item(withTag: Tag.pauseCovered)?.state = pauseWhenCovered ? .on : .off
        menu.item(withTag: Tag.login)?.state = SMAppService.mainApp.status == .enabled ? .on : .off

        if let sub = menu.item(withTag: Tag.viewMenu)?.submenu {
            let current = stats["viewIndex"] as? Int ?? -1
            sub.items.forEach { $0.state = $0.tag == current ? .on : .off }
        }
        if let sub = menu.item(withTag: Tag.speedMenu)?.submenu {
            let current = stats["speed"] as? String
            sub.items.forEach { $0.state = $0.title == current ? .on : .off }
        }
        if let sub = menu.item(withTag: Tag.lightMenu)?.submenu {
            let current = stats["earthLighting"] as? String
            sub.items.forEach { $0.state = ($0.representedObject as? String) == current ? .on : .off }
        }
        if let sub = menu.item(withTag: Tag.zenMenu)?.submenu {
            let current = stats["zen"] as? String
            sub.items.forEach { $0.state = ($0.representedObject as? String) == current ? .on : .off }
        }
        if let sub = menu.item(withTag: Tag.idleMenu)?.submenu {
            for entry in sub.items {
                if let seconds = entry.representedObject as? Double {
                    entry.state = seconds == idleThreshold ? .on : .off
                } else if let mode = entry.representedObject as? String {
                    entry.state = mode == idleZenMode ? .on : .off
                }
            }
        }
    }

    // MARK: - Actions

    @objc private func pickView(_ sender: NSMenuItem) { broadcast("setView(\(sender.tag))") }
    @objc private func pickSpeed(_ sender: NSMenuItem) { broadcast("setSpeed(\(sender.tag))") }
    @objc private func togglePause() { broadcast("togglePause()") }
    @objc private func today() { broadcast("today()") }
    @objc private func toggleEarthFocus(_ sender: NSMenuItem) {
        broadcast("setEarthFocus(\(sender.state == .on ? "false" : "true"))")
    }
    @objc private func pickLighting(_ sender: NSMenuItem) {
        broadcast("setEarthLighting('\(sender.representedObject as? String ?? "accurate")')")
    }
    @objc private func pickZen(_ sender: NSMenuItem) {
        // A hand-picked animation stays until it is changed by hand.
        zenFromIdle = false
        if let mode = sender.representedObject as? String {
            broadcast("setZen('\(mode)', \(zenFrameRate))")
        } else {
            broadcast("setZen(null)")
        }
    }
    @objc private func toggleLabels(_ sender: NSMenuItem) {
        broadcast("setLabels(\(sender.state == .on ? "false" : "true"))")
    }
    @objc private func toggleOrbits(_ sender: NSMenuItem) {
        broadcast("setOrbits(\(sender.state == .on ? "false" : "true"))")
    }
    @objc private func toggleChrome() {
        chromeVisible.toggle()
        broadcast("setChrome(\(chromeVisible))")
        updateMenuState()
    }

    /// The page's own C shortcut writes to the clipboard, which a background
    /// WebView cannot do. Fetch the line and put it on the pasteboard here.
    @objc private func copyPreset() {
        surfaces.first?.query("presetLine()") { value in
            guard let line = value as? String else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(line, forType: .string)
            Log.write("[menu] copied preset: \(line)")
        }
    }

    // MARK: - Studio

    /// The studio is an ordinary window, so while it is open the app becomes a
    /// regular app: Dock icon, real menu bar, ⌘W and ⌘Q. It drops back to a
    /// menu-bar-only accessory when the window closes, so the wallpaper does
    /// not leave clutter behind.
    @objc private func openStudio() {
        if studio == nil {
            let controller = StudioWindowController(webDirectory: webDirectory)

            controller.onApply = { [weak self] snapshot in
                guard let self,
                      let data = try? JSONSerialization.data(withJSONObject: snapshot),
                      let json = String(data: data, encoding: .utf8) else { return }
                self.surfaces.forEach { $0.command("apply(\(json))") }
                Log.write("[studio] applied to \(self.surfaces.count) display(s)")
            }

            controller.onRequestDesktopSnapshot = { [weak self] completion in
                guard let surface = self?.surfaces.first else { completion(nil); return }
                surface.query("snapshot()") { value in
                    completion(value as? [String: Any])
                }
            }

            if ProcessInfo.processInfo.environment["SOLAR_WALLPAPER_SELFTEST"] == "studio" {
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.runStudioTest() }
            }

            controller.onClose = { [weak self] in
                self?.studio = nil
                NSApp.setActivationPolicy(.accessory)
                Log.write("[studio] closed")
            }

            studio = controller
            Log.write("[studio] opened")
        }

        installMainMenu()
        NSApp.setActivationPolicy(.regular)
        studio?.showWindow(nil)
        studio?.window?.center()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// An accessory app has no main menu. One is needed once the studio makes
    /// the app regular, otherwise the window has no ⌘W, ⌘Q or Edit commands.
    private func installMainMenu() {
        guard NSApp.mainMenu == nil else { return }
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide Solar Wallpaper",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Close Studio",
                        action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        appMenu.addItem(withTitle: "Quit Solar Wallpaper",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        NSApp.mainMenu = main
    }

    @objc private func pickIdleDelay(_ sender: NSMenuItem) {
        idleThreshold = sender.representedObject as? Double ?? 0
        saveIdleSettings()
        if idleThreshold == 0, zenFromIdle {
            zenFromIdle = false
            surfaces.forEach { $0.command("setZen(null)") }
        }
        Log.write("[idle] threshold now \(Int(idleThreshold))s")
        updateMenuState()
    }

    @objc private func pickIdleMode(_ sender: NSMenuItem) {
        idleZenMode = sender.representedObject as? String ?? "astronomical"
        saveIdleSettings()
        if zenFromIdle { surfaces.forEach { $0.command("setZen('\(idleZenMode)', \(idleZenFrameRate))") } }
        Log.write("[idle] animation now \(idleZenMode)")
        updateMenuState()
    }

    @objc private func reloadAll() { reloadEverything() }
    @objc private func openWebFolder() { NSWorkspace.shared.open(webDirectory) }
    @objc private func openLog() { NSWorkspace.shared.open(Log.fileURL) }
    @objc private func quit() { NSApp.terminate(nil) }

    private func presentMissingWebApp() {
        let alert = NSAlert()
        alert.messageText = "Web app not found"
        alert.informativeText = """
            Expected index.html in:
            \(webDirectory.path)

            Set SOLAR_WALLPAPER_WEB_DIR to point somewhere else.
            """
        alert.alertStyle = .critical
        alert.runModal()
        NSApp.terminate(nil)
    }
}
