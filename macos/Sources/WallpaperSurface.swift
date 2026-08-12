import Cocoa
import WebKit

/// One desktop-level window plus the WKWebView rendering the scene into it.
/// There is one surface per attached display.
final class WallpaperSurface: NSObject, WKNavigationDelegate {

    let window: WallpaperWindow
    let webView: WKWebView
    let displayName: String
    let screenFrame: NSRect

    /// Last reading from `WallpaperBridge.stats()`.
    private(set) var stats: [String: Any] = [:]
    private(set) var isLoaded = false
    /// True while the page has been told to stop painting entirely.
    private(set) var isSuspended = false

    private let webDirectory: URL
    private let dprCap: Double
    private let frameRate: Int
    private let sceneInterval: Int
    private let zenFrameRate: Int
    private var loadWatchdog: Timer?
    private var lastStatsAt = Date()

    init(screen: NSScreen, webDirectory: URL, index: Int, dprCap: Double, frameRate: Int, sceneInterval: Int, zenFrameRate: Int) {
        self.webDirectory = webDirectory
        self.dprCap = dprCap
        self.frameRate = frameRate
        self.sceneInterval = sceneInterval
        self.zenFrameRate = zenFrameRate
        self.displayName = screen.localizedName.isEmpty ? "Display \(index + 1)" : screen.localizedName
        self.screenFrame = screen.frame
        self.window = WallpaperWindow(screen: screen)

        let controller = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.suppressesIncrementalRendering = false

        self.webView = WKWebView(frame: screen.frame, configuration: config)
        super.init()

        // Must run before app.js, which reads both of these at startup.
        controller.addUserScript(WKUserScript(source: bootstrap(),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))

        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.underPageBackgroundColor = window.backgroundColor
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window.contentView = webView
        load()
        window.orderFrontRegardless()
    }

    // MARK: - Loading

    func load() {
        isLoaded = false
        isSuspended = false

        // Reloading index.html is not enough: WebKit keeps app.js and
        // styles.css in its cache and happily serves the old copies, so a
        // live reload would appear to work while running stale code. Clearing
        // the cache first is what actually makes editing app.js take effect.
        let caches: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
        WKWebsiteDataStore.default().removeData(ofTypes: caches, modifiedSince: .distantPast) { [weak self] in
            guard let self else { return }
            self.webView.loadFileURL(self.webDirectory.appendingPathComponent("index.html"),
                                     allowingReadAccessTo: self.webDirectory)
        }

        // App Nap used to make this fail with no error at all. Keep a
        // watchdog so any future silent failure names itself.
        loadWatchdog?.invalidate()
        loadWatchdog = Timer.scheduledTimer(withTimeInterval: 6.0, repeats: false) { [weak self] _ in
            guard let self, !self.isLoaded else { return }
            Log.write("[error] \(self.displayName): index.html never loaded from \(self.webDirectory.path)")
        }
    }

    func reload() { load() }

    /// Stop or restart painting. No-ops unless the state actually changes,
    /// including while the page is still loading — otherwise a caller polling
    /// on a timer would log the same transition over and over.
    @discardableResult
    func setRendering(_ on: Bool, reason: String = "") -> Bool {
        guard isLoaded, on == isSuspended else { return false }
        isSuspended = !on
        command("setRendering(\(on))")
        Log.write("[power] \(displayName): \(on ? "resumed" : "paused")\(reason.isEmpty ? "" : " — \(reason)")")
        return true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoaded = true
        loadWatchdog?.invalidate()
        Log.write("[load] \(displayName): ready")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.write("[load] \(displayName): FAILED \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Log.write("[load] \(displayName): FAILED (provisional) \(error.localizedDescription)")
    }

    // MARK: - Bridge

    /// Fire-and-forget command against `window.WallpaperBridge`.
    func command(_ expression: String) {
        guard isLoaded else { return }
        webView.evaluateJavaScript("window.WallpaperBridge && WallpaperBridge.\(expression)") { _, error in
            if let error { Log.write("[bridge] \(self.displayName): \(expression) — \(error.localizedDescription)") }
        }
    }

    /// Reads a JSON-shaped value out of the bridge.
    func query(_ expression: String, completion: @escaping (Any?) -> Void) {
        guard isLoaded else { completion(nil); return }
        webView.evaluateJavaScript("window.WallpaperBridge ? WallpaperBridge.\(expression) : null") { value, _ in
            completion(value)
        }
    }

    func refreshStats(completion: (() -> Void)? = nil) {
        let interval = Date().timeIntervalSince(lastStatsAt)
        query("stats()") { [weak self] value in
            guard let self else { return }
            if let dictionary = value as? [String: Any] {
                self.stats = dictionary
                self.lastStatsAt = Date()
                let painted = dictionary["frames"] as? Double ?? 0
                let repaints = dictionary["repaints"] as? Double ?? 0
                self.stats["fps"] = interval > 0 ? painted / interval : 0
                self.stats["repaintsPerSecond"] = interval > 0 ? repaints / interval : 0
            }
            completion?()
        }
    }

    /// Frames actually painted per second — not requestAnimationFrame ticks.
    var paintedFPS: Double { stats["fps"] as? Double ?? 0 }

    /// Full scene repaints per second — the expensive path the cache avoids.
    var repaintsPerSecond: Double { stats["repaintsPerSecond"] as? Double ?? 0 }

    // MARK: - Injected bootstrap

    /// Everything the page needs to know about its host, set before app.js runs.
    private func bootstrap() -> String {
        """
        (function () {
          // Idle rate while time runs in real time and nothing moves; the
          // active rate applies to accelerated time and Zen, where it shows.
          window.__WALLPAPER__ = {
            mode: 'wallpaper',
            fps: \(frameRate),
            activeFps: \(max(frameRate, 20)),
            zenFps: \(zenFrameRate),
            sceneInterval: \(sceneInterval)
          };

          // Cap the backing store. app.js does
          // state.dpr = Math.min(devicePixelRatio || 1, 2), so lowering the
          // reported ratio shrinks the canvas the GPU process rasterizes.
          var real = window.devicePixelRatio || 1;
          var capped = Math.min(real, \(dprCap));
          if (capped !== real) {
            Object.defineProperty(window, 'devicePixelRatio', {
              get: function () { return capped; }
            });
          }
        })();
        """
    }
}
