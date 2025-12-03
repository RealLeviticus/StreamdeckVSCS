# StreamdeckVSCS

## How to use
- Install with the bundled `StreamdeckVSCSInstaller.exe` (copies the vatSys plugin and triggers the Stream Deck install prompt).
- In Stream Deck, add the “VSCS Line” action to a key.
- Each line button can be set to **Auto-detect** or **Manual pick**:
  - **Auto-detect + ID**: Assign a unique numeric ID (1–20) to each button. As VSCS lines appear, the plugin maps one line per ID (hotlines first, then coldlines). Each ID is only used once, so you won’t get duplicate lines on different buttons, and the mapping stays stable even if VSCS reorders or reconnects lines.
  - **Manual**: Pick a specific line from the detected list. The button is locked to that line only.
- Buttons reflect VSCS status without opening the VSCS window:
  - Hotlines: idle yellow; active green.
  - Coldlines: idle blue; pending flashes purple/blue; active solid purple.

## How to build

The repo contains the bridge plugin that needs to be built and added to vatSys, as well as the Streamdeck Plugin which needs to be packaged for updates or initial deployment.

## Building the vatSys Plugin
To build the vatSys plugin, follow these steps:

1. Open the solution file (`.sln`) for the vatSys plugin in Visual Studio.
2. Ensure you have the required .NET development tools, including the proper SDKs, installed.
3. Restore any NuGet packages by navigating to **Tools > NuGet Package Manager > Manage NuGet Packages for Solution...** and restoring missing packages if necessary.
4. Use the **Build** option in the **Build** menu or press `Ctrl + Shift + B` to compile the project.
5. Once built successfully, locate the output `.dll` file in the `bin/Release` (or `bin/Debug` depending on your build settings) directory.
6. Copy the `.dll` file to the appropriate vatSys plugins folder as required.

## Building the Streamdeck Plugin
To build the Streamdeck plugin, follow these steps:

1. Open Visual Studio Code and load the folder containing the Streamdeck plugin.
2. Ensure Node.js is installed on your system. If it isn't, download and install the latest version from [Node.js official website](https://nodejs.org/).
3. Run the following command to install the required dependencies:

   ```bash
   npm install
   ```

4. Build the plugin with:

   ```bash
   npm run build
   ```

5. Package the plugin by running:

   ```bash
   npm run package
   ```

6. Locate the packaged Streamdeck plugin file. The terminal will provide the file's location upon a successful packaging process.
7. Double-click the packaged file to install the plugin in your Streamdeck setup.
