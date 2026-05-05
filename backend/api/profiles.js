import { cors } from './cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  let profiles = [];
  try {
    const raw = JSON.parse(process.env.COMMITTEE_PROFILES || '[]');
    // Return only id + name — never expose tokens
    profiles = raw.map(p => ({ id: p.id, name: p.name }));
  } catch {}

  // Always have at least a default
  if (!profiles.length) {
    profiles = [{ id: 'main', name: 'Kumitat Ċentrali' }];
  }

  return res.status(200).json(profiles);
}
