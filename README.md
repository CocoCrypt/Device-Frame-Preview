# Device Frame Preview

**Preview your website inside realistic phone, tablet, laptop and monitor frames — right in VS Code.**

🇫🇷 [Version française](README.fr.md)

![Switching between iPhone, Galaxy, iPad, MacBook and multi-device view](images/demo.png)

## One-click start

Click **Preview** in the status bar (bottom right) or press **`Ctrl+Alt+P`** (`Cmd+Alt+P` on Mac):

- **an HTML file is open** → it is previewed, with live reload on every save;
- **otherwise** → the extension **automatically detects your running dev server** (Vite, Next.js, Angular, Django, Laravel, PHP, Flask…) and shows it. If several are running, it asks which one.

You can also right-click an `.html` file → *Preview this HTML file*.

![Multi-device view: iPhone, iPad and MacBook side by side](images/multi-device.png)

## Features

- **71 devices**: iPhone (5 to 17 Pro Max), Pixel, Galaxy, Xiaomi, OnePlus, foldables (Z Fold, Z Flip, Pixel Fold), iPad, Galaxy Tab, Surface, MacBook, laptops and monitors up to ultrawide.
- **Realistic frames**: Dynamic Island, notch or punch-hole depending on the model, status bar, laptop and desktop monitor frames.
- **Multi-device view** (⊞): phone, tablet and computer side by side, with **synchronized navigation**.
- **Live reload** for HTML files: CSS is applied without reloading, scroll position is kept, changes made outside VS Code are detected.
- **Rotate**, **zoom**, show/hide frame, **custom size** and your own custom devices.
- **Server stopped?** A message is shown and the preview reloads automatically as soon as your server is back.
- The preview is **restored** when VS Code restarts.
- Available in **English** and **French** (follows your VS Code language).

Shortcuts inside the preview: `R` rotate · `F` frame · `M` multi-device.

| iPhone 17 Pro | Galaxy S24 Ultra & iPhone 14 |
|---|---|
| ![Preview in an iPhone 17 Pro](images/iphone.png) | ![Preview in a Galaxy S24 Ultra and an iPhone 14](images/android-iphone.png) |

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `devicePreview.defaultUrl` | `http://localhost:3000` | URL used when no server is detected |
| `devicePreview.defaultDevice` | `iphone-15` | Device used the first time |
| `devicePreview.multiDevices` | `["iphone-15", "ipad-air", "laptop-13"]` | Devices shown in multi-device view |
| `devicePreview.customDevices` | `[]` | Your own devices, e.g. `[{ "name": "My phone", "width": 390, "height": 844 }]` |
| `devicePreview.autoReload` | `true` | Live reload in HTML file mode |
| `devicePreview.proxy` | `true` | Local proxy (see below) |
| `devicePreview.showStatusBar` | `true` | “Preview” button in the status bar |

## Privacy & security

Many frameworks (Django, Rails…) forbid their pages from being displayed in a frame (`X-Frame-Options`, `frame-ancestors`), which would give a blank preview. To avoid that, the extension routes pages through a **small local proxy** that removes only those two headers.

- The proxy listens **only on your machine** (`127.0.0.1`), never on the network.
- It is only used for the preview inside VS Code: your site, code and configuration are **not modified**.
- It stops when you close the preview.
- **No data is sent anywhere**; the extension collects nothing.

You can turn it off with `"devicePreview.proxy": false`.

## Known limitations

- Sizes match each device's **viewport** (CSS pixels); rendering is done by VS Code's engine (Chromium), not iOS Safari.
- The user agent is not changed: sites that detect mobile on the server side will show their desktop version.

## Feedback

Found a bug or want a device added? [Open an issue](https://github.com/CocoCrypt/Device-Frame-Preview/issues).

## License

MIT
