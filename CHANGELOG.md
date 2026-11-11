# Changelog

## 0.5.2
- Custom devices: new `radius` option, and `notch` accepts `island`, `notch` or `punch`. / Appareils personnalisés : nouvelle option `radius`, et `notch` accepte `island`, `notch` ou `punch`.
- `devicePreview.defaultDevice` now suggests the device list. / `devicePreview.defaultDevice` propose désormais la liste des appareils.
- Fix: the page no longer spills past the rounded screen corners of the frame. / Correctif : la page ne déborde plus des coins arrondis de l'écran.
- Fix: seeking in videos and audio served from an HTML file (HTTP range requests). / Correctif : on peut avancer dans les vidéos et sons servis en mode fichier HTML (requêtes partielles).
- Fix: proxied pages that are not in UTF-8 keep their accents. / Correctif : les pages qui ne sont pas en UTF-8 gardent leurs accents via le proxy.
- Fix: links to `localhost`, `127.0.0.1`, `[::1]` and `//host` stay inside the proxy. / Correctif : les liens vers `localhost`, `127.0.0.1`, `[::1]` et `//hôte` restent dans le proxy.
- Fix: a previewed page can no longer control the preview through messages. / Correctif : une page affichée ne peut plus piloter l'aperçu par messages.

## 0.5.1
- Each device presents its own user-agent (iPhone, Android, iPad) to the page and to the server. / Chaque appareil présente son propre user-agent (iPhone, Android, iPad) à la page et au serveur.
- Touch emulation: touch events, drag-to-scroll with inertia, `(pointer: coarse)` and `(hover: none)`. / Émulation tactile : événements tactiles, défilement au glisser avec inertie, `(pointer: coarse)` et `(hover: none)`.
- Light / dark mode toggle (`prefers-color-scheme`), applied without reloading. / Bascule clair / sombre (`prefers-color-scheme`), appliquée sans rechargement.
- Safe areas: `viewport-fit=cover` and `env(safe-area-inset-*)` on iPhones with a notch or Dynamic Island. / Zones sûres : `viewport-fit=cover` et `env(safe-area-inset-*)` sur les iPhone à encoche ou Dynamic Island.
- Slow network simulation (Fast 4G, Slow 4G, 3G). / Simulation de réseau lent (4G rapide, 4G lente, 3G).
- Synchronized scrolling in multi-device view. / Défilement synchronisé en vue multi-appareils.
- Breakpoints view: frameless widths side by side. / Mode points de rupture : largeurs sans cadre côte à côte.
- Device search (name or width), favorites and recent devices. / Recherche d'appareil (nom ou largeur), favoris et appareils récents.
- Custom size: rulers and drag-to-resize handles. / Taille personnalisée : règles et poignées de redimensionnement.
- Remote SSH, WSL, Dev Containers and Codespaces support. / Prise en charge de Remote SSH, WSL, Dev Containers et Codespaces.
- Unit tests, CI, and Open VSX publishing. / Tests unitaires, intégration continue et publication sur Open VSX.

## 0.4.0
- English is now the default language; French is used automatically when VS Code is in French. / L’extension est maintenant en anglais par défaut, et en français si VS Code est en français.
- New animated demo and screenshots in the README. / Nouvelle démo animée et nouvelles captures dans le README.

## 0.3.1
- Barre d’état réaliste (heure, réseau, batterie) sur les téléphones : la Dynamic Island et l’encoche ne cachent plus le haut de la page.
- Correction : la base des PC portables n’est plus coupée en mode multi-appareils.

## 0.3.0
- Première version publique.
- 71 appareils : iPhone, Android, pliables, iPad, tablettes, PC portables, écrans de bureau.
- Mode multi-appareils avec navigation synchronisée.
- Détection automatique des serveurs de dev locaux.
- Rechargement live des fichiers HTML (CSS à chaud, scroll conservé).
- Proxy local pour afficher les sites qui refusent d'être intégrés (Django…).
- Raccourci `Ctrl+Alt+P` et bouton dans la barre d'état.
