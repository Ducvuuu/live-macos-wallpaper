import Cocoa
import WebKit

/// A normal, fully interactive window running the same scene as the desktop.
///
/// The wallpaper window has to ignore mouse and keyboard events so desktop
/// icons keep working, which leaves dragging, scrolling and all sixteen
/// keyboard shortcuts unreachable there. This window is where they live: it is
/// an ordinary app window, so the page behaves exactly as it does in a
/// browser. Compose here, then push the result to the desktop.
final class StudioWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {

    /// Called with the studio's snapshot when the user hits Apply to Desktop.
    var onApply: (([String: Any]) -> Void)?
    /// Asks the host for the desktop's current snapshot, to pull it in here.
    var onRequestDesktopSnapshot: ((@escaping ([String: Any]?) -> Void) -> Void)?
    var onClose: (() -> Void)?

    private let webDirectory: URL
    private var webView: WKWebView!
    private var readout: NSTextField!
    private var hint: NSTextField!
    private var readoutTimer: Timer?
    private var isLoaded = false

    init(webDirectory: URL) {
        self.webDirectory = webDirectory

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Studio — Watercolor Solar System"
        window.minSize = NSSize(width: 760, height: 540)
        window.setFrameAutosaveName("StudioWindow")
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed

        super.init(window: window)
        window.delegate = self
        buildInterface()
        load()
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    // MARK: - Interface

    private func buildInterface() {
        guard let window, let content = window.contentView else { return }

        let toolbar = NSVisualEffectView()
        toolbar.material = .headerView
        toolbar.blendingMode = .withinWindow
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        let apply = button("Apply to Desktop", #selector(applyToDesktop))
        apply.keyEquivalent = "\r"
        apply.bezelColor = .controlAccentColor
        apply.toolTip = "Send this composition to every display"

        let match = button("Match Desktop", #selector(matchDesktop))
        match.toolTip = "Pull the desktop's current composition into the studio"

        let copy = button("Copy Preset", #selector(copyPreset))
        copy.toolTip = "Copy this camera as a line for the VIEWS array in app.js"

        let reset = button("Reset View", #selector(resetView))
        reset.toolTip = "Discard changes and return to the selected preset"

        let buttons = NSStackView(views: [apply, match, copy, reset])
        buttons.orientation = .horizontal
        buttons.spacing = 8
        buttons.translatesAutoresizingMaskIntoConstraints = false

        hint = label("Drag to fly · shift-drag to roll · ⌘-drag moves the Sun · scroll to zoom · H for help",
                     secondary: true)
        hint.translatesAutoresizingMaskIntoConstraints = false

        toolbar.addSubview(buttons)
        toolbar.addSubview(hint)

        // Web view. No wallpaper mode here: chrome stays visible, the full
        // frame rate applies, and every control works because this window
        // accepts events like any other.
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: Self.bootstrap,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        let footer = NSVisualEffectView()
        footer.material = .headerView
        footer.blendingMode = .withinWindow
        footer.translatesAutoresizingMaskIntoConstraints = false

        readout = label("…", secondary: false)
        readout.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        readout.isSelectable = true
        readout.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(readout)

        content.addSubview(toolbar)
        content.addSubview(webView)
        content.addSubview(footer)

        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: content.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 46),

            buttons.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 14),
            buttons.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),

            hint.leadingAnchor.constraint(greaterThanOrEqualTo: buttons.trailingAnchor, constant: 14),
            hint.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -14),
            hint.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),

            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: footer.topAnchor),

            footer.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 28),

            readout.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 14),
            readout.trailingAnchor.constraint(lessThanOrEqualTo: footer.trailingAnchor, constant: -14),
            readout.centerYAnchor.constraint(equalTo: footer.centerYAnchor)
        ])

        hint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .regular
        return button
    }

    private func label(_ text: String, secondary: Bool) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .systemFont(ofSize: 11)
        field.textColor = secondary ? .secondaryLabelColor : .labelColor
        field.lineBreakMode = .byTruncatingTail
        return field
    }

    // MARK: - Loading

    private func load() {
        webView.loadFileURL(webDirectory.appendingPathComponent("index.html"),
                            allowingReadAccessTo: webDirectory)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoaded = true
        Log.write("[studio] ready")
        window?.makeFirstResponder(webView)

        readoutTimer?.invalidate()
        readoutTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            self?.refreshReadout()
        }
    }

    private func refreshReadout() {
        guard isLoaded else { return }
        webView.evaluateJavaScript("window.WallpaperBridge ? WallpaperBridge.presetLine() : null") { value, _ in
            if let line = value as? String { self.readout.stringValue = line }
        }
    }

    private func flash(_ message: String) {
        hint.stringValue = message
        hint.textColor = .labelColor
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            self.hint.stringValue = "Drag to fly · shift-drag to roll · ⌘-drag moves the Sun · scroll to zoom · H for help"
            self.hint.textColor = .secondaryLabelColor
        }
    }

    // MARK: - Actions

    var ready: Bool { isLoaded }

    /// Escape hatch for diagnostics — drives the studio's page directly.
    func evaluate(_ javaScript: String, completion: ((Any?) -> Void)? = nil) {
        guard isLoaded else { completion?(nil); return }
        webView.evaluateJavaScript(javaScript) { value, _ in completion?(value) }
    }

    @objc func applyToDesktop() {
        guard isLoaded else { return }
        webView.evaluateJavaScript("JSON.stringify(WallpaperBridge.snapshot())") { value, error in
            guard let json = value as? String,
                  let data = json.data(using: .utf8),
                  let snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                Log.write("[studio] apply failed: \(error?.localizedDescription ?? "no snapshot")")
                self.flash("Could not read the current composition")
                return
            }
            self.onApply?(snapshot)
            self.flash("Applied to the desktop")
        }
    }

    @objc private func matchDesktop() {
        onRequestDesktopSnapshot? { snapshot in
            guard let snapshot,
                  let data = try? JSONSerialization.data(withJSONObject: snapshot),
                  let json = String(data: data, encoding: .utf8) else {
                self.flash("Could not read the desktop")
                return
            }
            self.webView.evaluateJavaScript("WallpaperBridge.apply(\(json))") { _, error in
                if let error {
                    Log.write("[studio] match failed: \(error.localizedDescription)")
                    self.flash("Could not match the desktop")
                } else {
                    self.flash("Matched the desktop")
                }
            }
        }
    }

    @objc private func copyPreset() {
        guard isLoaded else { return }
        webView.evaluateJavaScript("WallpaperBridge.presetLine()") { value, _ in
            guard let line = value as? String else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(line, forType: .string)
            self.flash("Preset copied — paste it into VIEWS in app.js")
        }
    }

    @objc private func resetView() {
        guard isLoaded else { return }
        webView.evaluateJavaScript("WallpaperBridge.resetView()")
        flash("Returned to the preset")
    }

    // MARK: - Window

    func windowWillClose(_ notification: Notification) {
        readoutTimer?.invalidate()
        readoutTimer = nil
        onClose?()
    }

    /// Chrome visible, full frame rate, but no idle Zen — composing a shot
    /// often means sitting still and thinking, and being ambushed by the
    /// screensaver mid-adjustment is not helpful.
    private static let bootstrap = """
    window.__WALLPAPER__ = { autoZen: false };
    """
}
