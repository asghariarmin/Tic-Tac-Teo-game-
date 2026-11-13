import AppKit
import WebKit

final class Launcher: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 1140, height: 770),
        styleMask: [.titled, .closable, .miniaturizable, .resizable],
        backing: .buffered,
        defer: false
    )
    private let browser = WKWebView()
    private var server: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var startup = Data()
    private var gameURL: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setUpMenus()
        window.title = "Tic Tac Toe"
        window.minSize = NSSize(width: 360, height: 460)
        window.isReleasedWhenClosed = false
        window.center()
        browser.navigationDelegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startGame()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        stopGame()
    }

    private func setUpMenus() {
        let menuBar = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Tic Tac Toe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menuBar.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        menuBar.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        menuBar.addItem(windowItem)
        NSApp.mainMenu = menuBar
        NSApp.windowsMenu = windowMenu
    }

    private func showMessage(_ message: String, retry: Bool = false) {
        let label = NSTextField(wrappingLabelWithString: message)
        label.alignment = .center
        label.font = .systemFont(ofSize: 15)
        let stack = NSStackView(views: [label])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        if retry {
            stack.addArrangedSubview(NSButton(title: "Try Again", target: self, action: #selector(startGame)))
        }
        let view = NSView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 420)
        ])
        window.contentView = view
    }

    @objc private func startGame() {
        stopGame()
        showMessage("Starting Tic Tac Toe…")
        let paths = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        let node = (["/usr/local/bin", "/opt/homebrew/bin"] + paths)
            .filter { $0.hasPrefix("/") }
            .map { "\($0)/node" }
            .first { FileManager.default.isExecutableFile(atPath: $0) }
        guard let node else {
            showMessage("Tic Tac Toe needs Node.js 22 or newer. Install Node.js and try again.", retry: true)
            return
        }

        guard let game = Bundle.main.resourceURL?.appendingPathComponent("Game/server.js"),
              FileManager.default.fileExists(atPath: game.path) else {
            showMessage("The game files are missing. Open a complete copy of Tic Tac Toe.")
            return
        }

        let process = Process()
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [game.path]
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = "0"
        environment["PIXEL_ARCADE_DESKTOP"] = "1"
        process.environment = environment
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = outputPipe
        outputPipe.fileHandleForReading.readabilityHandler = { [weak self, weak process] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async {
                guard let self, let process, self.server === process else { return }
                self.readStartup(bytes)
            }
        }
        process.terminationHandler = { [weak self] ended in
            DispatchQueue.main.async {
                guard let self, self.server === ended else { return }
                self.stopGame()
                self.showMessage("The game server stopped. Open the game again with Node.js 22 or newer.", retry: true)
            }
        }

        server = process
        input = inputPipe
        output = outputPipe
        do {
            try process.run()
        } catch {
            stopGame()
            showMessage("Could not start the game server. \(error.localizedDescription)", retry: true)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self, weak process] in
            guard let self, let process, self.server === process, self.gameURL == nil else { return }
            self.stopGame()
            self.showMessage("The game server took too long to start.", retry: true)
        }
    }

    private func readStartup(_ bytes: Data) {
        guard gameURL == nil else { return }
        startup.append(bytes)
        while let end = startup.firstIndex(of: 10) {
            let line = String(decoding: startup[..<end], as: UTF8.self)
            startup.removeSubrange(...end)
            let prefix = "  Local: "
            guard line.hasPrefix(prefix), let url = URL(string: String(line.dropFirst(prefix.count))),
                  url.scheme == "http", url.host == "localhost", url.port != nil else { continue }
            gameURL = url
            window.contentView = browser
            browser.load(URLRequest(url: url))
            return
        }
    }

    private func stopGame() {
        let process = server
        server = nil
        gameURL = nil
        startup.removeAll()
        output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close()
        input = nil
        output = nil
        if let process, process.isRunning { process.terminate() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard gameURL != nil, (error as NSError).code != NSURLErrorCancelled else { return }
        stopGame()
        showMessage("The game page could not open. \(error.localizedDescription)", retry: true)
    }
}

let app = NSApplication.shared
let launcher = Launcher()
app.setActivationPolicy(.regular)
app.delegate = launcher
app.run()
