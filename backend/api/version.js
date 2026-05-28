import { cors } from './cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    backend_version: process.env.BACKEND_VERSION || '1.0.0',
    minimum_desktop_version: process.env.MIN_DESKTOP_VERSION || '1.0.0',
    latest_desktop_version: process.env.UPDATE_VERSION || null,
    updates_configured: Boolean(process.env.UPDATE_VERSION && process.env.UPDATE_URL && process.env.UPDATE_SIGNATURE),
  });
}
