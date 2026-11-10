// Noms en anglais : traduits via l10n/bundle.l10n.*.json (WEBVIEW_STRINGS dans extension.js)
// Tailles en pixels CSS (viewport), comme dans les DevTools des navigateurs.
// type  : phone | tablet | laptop | desktop  → style du cadre
// notch : 'island' (Dynamic Island) | 'notch' (encoche) | 'punch' (poinçon) | absent
// Les identifiants (id) servent dans les réglages : ne pas les renommer.
window.DEVICES = [
  { group: 'iPhone', items: [
    { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max',            w: 440, h: 956, type: 'phone', radius: 58, notch: 'island' },
    { id: 'iphone-17-pro',     name: 'iPhone 17 / 17 Pro',           w: 402, h: 874, type: 'phone', radius: 56, notch: 'island' },
    { id: 'iphone-air',        name: 'iPhone Air',                   w: 420, h: 912, type: 'phone', radius: 56, notch: 'island' },
    { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max',            w: 440, h: 956, type: 'phone', radius: 58, notch: 'island' },
    { id: 'iphone-16-pro',     name: 'iPhone 16 Pro',                w: 402, h: 874, type: 'phone', radius: 56, notch: 'island' },
    { id: 'iphone-16-plus',    name: 'iPhone 16 Plus',               w: 430, h: 932, type: 'phone', radius: 56, notch: 'island' },
    { id: 'iphone-16',         name: 'iPhone 16',                    w: 393, h: 852, type: 'phone', radius: 52, notch: 'island' },
    { id: 'iphone-16e',        name: 'iPhone 16e',                   w: 390, h: 844, type: 'phone', radius: 48, notch: 'notch' },
    { id: 'iphone-15-max',     name: 'iPhone 15 Pro Max',            w: 430, h: 932, type: 'phone', radius: 56, notch: 'island' },
    { id: 'iphone-15',         name: 'iPhone 15 / 15 Pro',           w: 393, h: 852, type: 'phone', radius: 52, notch: 'island' },
    { id: 'iphone-14-plus',    name: 'iPhone 14 Plus / 13 Pro Max',  w: 428, h: 926, type: 'phone', radius: 52, notch: 'notch' },
    { id: 'iphone-14',         name: 'iPhone 14 / 13 / 12',          w: 390, h: 844, type: 'phone', radius: 48, notch: 'notch' },
    { id: 'iphone-13-mini',    name: 'iPhone 13 mini / 12 mini',     w: 375, h: 812, type: 'phone', radius: 44, notch: 'notch' },
    { id: 'iphone-11',         name: 'iPhone 11 / XR',               w: 414, h: 896, type: 'phone', radius: 44, notch: 'notch' },
    { id: 'iphone-x',          name: 'iPhone X / XS / 11 Pro',       w: 375, h: 812, type: 'phone', radius: 42, notch: 'notch' },
    { id: 'iphone-8-plus',     name: 'iPhone 8 Plus',                w: 414, h: 736, type: 'phone', radius: 8 },
    { id: 'iphone-se',         name: 'iPhone SE / 8',                w: 375, h: 667, type: 'phone', radius: 8 },
    { id: 'iphone-5',          name: 'iPhone 5 / SE (1st gen)',     w: 320, h: 568, type: 'phone', radius: 8 }
  ]},
  { group: 'Android', items: [
    { id: 'pixel-9-pro-xl',    name: 'Google Pixel 9 Pro XL',        w: 414, h: 921, type: 'phone', radius: 46, notch: 'punch' },
    { id: 'pixel-9',           name: 'Google Pixel 9 / 9 Pro',       w: 412, h: 923, type: 'phone', radius: 46, notch: 'punch' },
    { id: 'pixel-8',           name: 'Google Pixel 8',               w: 412, h: 915, type: 'phone', radius: 44, notch: 'punch' },
    { id: 'pixel-7',           name: 'Google Pixel 7',               w: 412, h: 915, type: 'phone', radius: 40, notch: 'punch' },
    { id: 'galaxy-s24-ultra',  name: 'Samsung Galaxy S24 Ultra',     w: 384, h: 824, type: 'phone', radius: 18, notch: 'punch' },
    { id: 'galaxy-s24-plus',   name: 'Samsung Galaxy S24+',          w: 384, h: 832, type: 'phone', radius: 40, notch: 'punch' },
    { id: 'galaxy-s24',        name: 'Samsung Galaxy S24 / S23',     w: 360, h: 780, type: 'phone', radius: 40, notch: 'punch' },
    { id: 'galaxy-s20-ultra',  name: 'Samsung Galaxy S20 Ultra',     w: 412, h: 915, type: 'phone', radius: 32, notch: 'punch' },
    { id: 'galaxy-a55',        name: 'Samsung Galaxy A55 / A54',     w: 412, h: 915, type: 'phone', radius: 34, notch: 'punch' },
    { id: 'galaxy-a15',        name: 'Samsung Galaxy A15 / A14',     w: 384, h: 832, type: 'phone', radius: 30, notch: 'punch' },
    { id: 'galaxy-a51',        name: 'Samsung Galaxy A51 / A71',     w: 412, h: 914, type: 'phone', radius: 30, notch: 'punch' },
    { id: 'galaxy-s8',         name: 'Samsung Galaxy S8+ / S9',      w: 360, h: 740, type: 'phone', radius: 30 },
    { id: 'xiaomi-14',         name: 'Xiaomi 14 / Redmi Note 13',    w: 393, h: 873, type: 'phone', radius: 40, notch: 'punch' },
    { id: 'oneplus-12',        name: 'OnePlus 12',                   w: 412, h: 919, type: 'phone', radius: 40, notch: 'punch' },
    { id: 'moto-g-power',      name: 'Motorola Moto G Power',        w: 412, h: 823, type: 'phone', radius: 30, notch: 'punch' },
    { id: 'android-360',       name: 'Android compact (360×800)',    w: 360, h: 800, type: 'phone', radius: 30, notch: 'punch' },
    { id: 'android-small',     name: 'Android legacy (360×640)',     w: 360, h: 640, type: 'phone', radius: 10 }
  ]},
  { group: 'Foldables', items: [
    { id: 'galaxy-fold',       name: 'Galaxy Z Fold (folded)',         w: 344, h: 882, type: 'phone', radius: 32, notch: 'punch' },
    { id: 'galaxy-fold-open',  name: 'Galaxy Z Fold (unfolded)',       w: 690, h: 829, type: 'tablet', radius: 20, notch: 'punch' },
    { id: 'galaxy-flip',       name: 'Galaxy Z Flip',                w: 412, h: 1004, type: 'phone', radius: 36, notch: 'punch' },
    { id: 'pixel-fold',        name: 'Pixel 9 Pro Fold (unfolded)',    w: 840, h: 806, type: 'tablet', radius: 20 },
    { id: 'surface-duo',       name: 'Surface Duo',                  w: 540, h: 720, type: 'phone', radius: 8 }
  ]},
  { group: 'iPad', items: [
    { id: 'ipad-pro-13',       name: 'iPad Pro 13" (M4)',            w: 1032, h: 1376, type: 'tablet', radius: 28 },
    { id: 'ipad-pro-12',       name: 'iPad Pro 12,9" / Air 13"',     w: 1024, h: 1366, type: 'tablet', radius: 28 },
    { id: 'ipad-pro-11-m4',    name: 'iPad Pro 11" (M4)',            w: 834,  h: 1210, type: 'tablet', radius: 28 },
    { id: 'ipad-pro-11',       name: 'iPad Pro 11" (2018-2022)',     w: 834,  h: 1194, type: 'tablet', radius: 28 },
    { id: 'ipad-air',          name: 'iPad Air 11" / iPad 10',       w: 820,  h: 1180, type: 'tablet', radius: 28 },
    { id: 'ipad-9',            name: 'iPad 9 (10,2")',               w: 810,  h: 1080, type: 'tablet', radius: 6 },
    { id: 'ipad-mini',         name: 'iPad mini (6th gen+)',     w: 744,  h: 1133, type: 'tablet', radius: 28 },
    { id: 'ipad-classic',      name: 'iPad classic / mini 5',      w: 768,  h: 1024, type: 'tablet', radius: 6 }
  ]},
  { group: 'Android tablets & more', items: [
    { id: 'galaxy-tab-s9-ultra', name: 'Galaxy Tab S9 Ultra',        w: 924,  h: 1480, type: 'tablet', radius: 20 },
    { id: 'galaxy-tab-s9',     name: 'Galaxy Tab S9',                w: 800,  h: 1280, type: 'tablet', radius: 24 },
    { id: 'galaxy-tab-a9',     name: 'Galaxy Tab A9+',               w: 800,  h: 1340, type: 'tablet', radius: 20 },
    { id: 'pixel-tablet',      name: 'Google Pixel Tablet',          w: 800,  h: 1280, type: 'tablet', radius: 24 },
    { id: 'surface-pro',       name: 'Surface Pro 7',                w: 912,  h: 1368, type: 'tablet', radius: 6 },
    { id: 'kindle-fire',       name: 'Kindle Fire HDX',              w: 800,  h: 1280, type: 'tablet', radius: 10 },
    { id: 'nest-hub',          name: 'Google Nest Hub',              w: 1024, h: 600,  type: 'tablet', radius: 12 },
    { id: 'nest-hub-max',      name: 'Google Nest Hub Max',          w: 1280, h: 800,  type: 'tablet', radius: 12 }
  ]},
  { group: 'Laptops', items: [
    { id: 'laptop-hd',         name: 'Laptop HD (1366×768)',       w: 1366, h: 768,  type: 'laptop' },
    { id: 'laptop-13',         name: 'Laptop 13" (1280×800)',      w: 1280, h: 800,  type: 'laptop' },
    { id: 'laptop-1440',       name: 'Laptop 1440×900',            w: 1440, h: 900,  type: 'laptop' },
    { id: 'laptop-15',         name: 'Laptop 15" (1536×864)',      w: 1536, h: 864,  type: 'laptop' },
    { id: 'laptop-fhd',        name: 'Laptop Full HD (1920×1080)', w: 1920, h: 1080, type: 'laptop' },
    { id: 'macbook-air-13',    name: 'MacBook Air 13"',              w: 1470, h: 956,  type: 'laptop' },
    { id: 'macbook-air-15',    name: 'MacBook Air 15"',              w: 1710, h: 1112, type: 'laptop' },
    { id: 'macbook-pro-14',    name: 'MacBook Pro 14"',              w: 1512, h: 982,  type: 'laptop' },
    { id: 'macbook-pro-16',    name: 'MacBook Pro 16"',              w: 1728, h: 1117, type: 'laptop' },
    { id: 'chromebook',        name: 'Chromebook (1366×768)',        w: 1366, h: 768,  type: 'laptop' }
  ]},
  { group: 'Desktop monitors', items: [
    { id: 'desktop-hd',        name: 'HD+ monitor (1600×900)',         w: 1600, h: 900,  type: 'desktop' },
    { id: 'desktop-fhd',       name: 'Full HD monitor (1920×1080)',    w: 1920, h: 1080, type: 'desktop' },
    { id: 'desktop-qhd',       name: 'QHD monitor (2560×1440)',        w: 2560, h: 1440, type: 'desktop' },
    { id: 'desktop-ultrawide', name: 'Ultrawide monitor (3440×1440)', w: 3440, h: 1440, type: 'desktop' },
    { id: 'imac-24',           name: 'iMac 24"',                     w: 2240, h: 1260, type: 'desktop' }
  ]}
];
