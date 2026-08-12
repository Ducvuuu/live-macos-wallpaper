import Cocoa

/// How much of a screen is hidden behind other applications' windows.
///
/// `NSWindow.occlusionState` cannot answer this. It reported `.visible`
/// continuously for the wallpaper windows even with the desktop fully covered,
/// which makes sense — a desktop-level window is never really "occluded" in
/// the sense AppKit means, it is just underneath everything by design. So the
/// coverage is computed directly from the window list instead.
enum Occlusion {

    /// Fraction of `frame` (in AppKit screen coordinates) covered by opaque,
    /// normal-level windows belonging to other processes. 0 means fully
    /// exposed, 1 means completely buried.
    static func coverage(of frame: NSRect, excluding pid: pid_t) -> Double {
        guard let primary = NSScreen.screens.first else { return 0 }

        // The window list uses top-left origin with y increasing downwards,
        // measured from the primary screen. AppKit uses bottom-left, y up.
        let rect = CGRect(x: frame.minX,
                          y: primary.frame.maxY - frame.maxY,
                          width: frame.width,
                          height: frame.height)

        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let listing = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return 0
        }

        var blockers: [CGRect] = []
        for window in listing {
            // Layer 0 is ordinary application windows. Panels, the Dock and
            // the menu bar sit above that and should not count as covering.
            guard window[kCGWindowLayer as String] as? Int == 0 else { continue }
            guard window[kCGWindowOwnerPID as String] as? pid_t != pid else { continue }
            guard window[kCGWindowAlpha as String] as? Double ?? 1 >= 0.9 else { continue }
            guard let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let box = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                  box.width > 80, box.height > 80 else { continue }

            let clipped = box.intersection(rect)
            if !clipped.isNull && !clipped.isEmpty { blockers.append(clipped) }
        }
        guard !blockers.isEmpty else { return 0 }

        // Sample a grid rather than computing an exact rectangle union: it is
        // simpler, fast enough at this rate, and correctly handles several
        // windows tiling together to cover the screen.
        let columns = 24, rows = 14
        var hits = 0
        for column in 0..<columns {
            for row in 0..<rows {
                let point = CGPoint(
                    x: rect.minX + (Double(column) + 0.5) / Double(columns) * rect.width,
                    y: rect.minY + (Double(row) + 0.5) / Double(rows) * rect.height)
                if blockers.contains(where: { $0.contains(point) }) { hits += 1 }
            }
        }
        return Double(hits) / Double(columns * rows)
    }
}
