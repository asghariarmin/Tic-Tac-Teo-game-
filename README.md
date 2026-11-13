# Pixel Arcade · Tic Tac Toe

On macOS, build the app with `bash macos/build.sh` using the Xcode Command Line Tools, then double-click **Tic Tac Toe.app** in Finder. The app runs the server in the background until you close its window. The game requires Node.js 22 or newer and has zero npm dependencies.

To run the web version locally, use `npm start` from this directory and open the Local URL printed in the terminal. Use `npm test` to check the game rules and multiplayer protocol.

## Deploy to your domain

1. Connect this repository to a host that runs a Node.js 22 or newer web service. Set the start command to `npm start` and let the host provide `PORT`.
2. Attach your domain to the service, enable HTTPS through the host, and set `PUBLIC_ORIGIN` to the full origin, such as `https://game.example.com`. Serve the app at the root of that domain.
3. Route the domain to one running instance and allow streaming HTTP responses so game updates arrive as they happen. Rooms live in that instance’s memory and reset when it restarts.
4. Open the domain on one device, choose **Network Play**, and create a room. Open its invite link on a second device to verify both devices receive moves.

## Play on two devices

1. Keep the server running on the host. Connect both devices to the same Wi-Fi or wired network.
2. On the host, choose **Network Play** and **Create Room**. Allow incoming connections to Node.js on the host if prompted.
3. On the second device, open the invite link in a browser. When running with `npm start`, you can also open the host’s printed **LAN** URL and enter the six-character room code. If the host has multiple network interfaces, use the address on the network both devices share.
4. Keep the game in the same tab to reconnect after a network interruption or refresh. **Leave Room** ends the room for both players. Stopping the server clears all rooms.

If the default port is in use, run `PORT=3001 npm start` on macOS or Linux. On Windows PowerShell, use `$env:PORT = '3001'` before `npm start`.
