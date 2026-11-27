// platforms.js — the channels a planned post (Kalendarju slot) can name: a short code, a label,
// a small tag and an icon. The codes match SLOT_PLATFORMS in backend/api/_lib/event-rules.js.
// Nothing is published from here; the app no longer talks to Facebook or Instagram.

export const PLATFORMS = [
  {
    id: 'fb', label: 'Facebook', short: 'FB',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z\"/></svg>",
  },
  {
    id: 'ig', label: 'Instagram', short: 'IG',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><rect x=\"2\" y=\"2\" width=\"20\" height=\"20\" rx=\"5\"/><path d=\"M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01\"/></svg>",
  },
  {
    id: 'tt', label: 'TikTok', short: 'TT',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5\"/><path d=\"M14 3c.4 2.4 2 4 4.5 4.2\"/></svg>",
  },
  {
    id: 'web', label: 'Website / App', short: 'WEB',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M8 20h8M12 16v4\"/></svg>",
  },
];

export const platformById = id => PLATFORMS.find(p => p.id === id);
