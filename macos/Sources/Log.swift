import Foundation

/// Minimal logger: stdout plus a file next to the app, so a detached launch
/// still leaves the occlusion/FPS trace behind for inspection.
enum Log {
    /// ~/Library/Logs is where a real app puts its log, and Console.app picks
    /// it up from there. The old location was the build workspace, which stops
    /// making sense once the app lives in /Applications.
    static let fileURL: URL = {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Logs")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("SolarWallpaper.log")
    }()

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    private static let queue = DispatchQueue(label: "solarwallpaper.log")

    static func start() {
        queue.async {
            try? "".write(to: fileURL, atomically: true, encoding: .utf8)
        }
        write("[start] Solar Wallpaper — pid \(ProcessInfo.processInfo.processIdentifier)")
    }

    static func write(_ line: String) {
        let stamped = "\(formatter.string(from: Date())) \(line)\n"
        FileHandle.standardOutput.write(Data(stamped.utf8))
        queue.async {
            if let handle = try? FileHandle(forWritingTo: fileURL) {
                handle.seekToEndOfFile()
                handle.write(Data(stamped.utf8))
                try? handle.close()
            } else {
                try? stamped.write(to: fileURL, atomically: true, encoding: .utf8)
            }
        }
    }
}
