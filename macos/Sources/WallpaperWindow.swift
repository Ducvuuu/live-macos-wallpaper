import Cocoa

/// A borderless window pinned to the desktop layer.
///
/// `.desktopWindow` sits *below* Finder's icon layer, so icons stay visible and
/// clickable on top of the scene. The window never becomes key or main, and
/// swallows no events — clicks fall straight through to the Finder.
final class WallpaperWindow: NSWindow {

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init(screen: NSScreen) {
        super.init(contentRect: screen.frame,
                   styleMask: [.borderless],
                   backing: .buffered,
                   defer: false)

        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]

        // The page paints an opaque #17243c background, so an opaque window
        // matching it avoids a white flash on load.
        isOpaque = true
        backgroundColor = NSColor(srgbRed: 0x17 / 255, green: 0x24 / 255, blue: 0x3c / 255, alpha: 1)

        hasShadow = false
        ignoresMouseEvents = true
        isReleasedWhenClosed = false
        displaysWhenScreenProfileChanges = true

        // contentRect is interpreted in screen-local terms by some styleMasks;
        // set the global frame explicitly so multi-display layouts land right.
        setFrame(screen.frame, display: false)
    }
}
