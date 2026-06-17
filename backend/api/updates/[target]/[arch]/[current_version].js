import { cors } from '../../../cors.js';

function keyFor(prefix, target, arch) {
  return `${prefix}_${target}_${arch}`.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
}

function valueFor(prefix, target, arch) {
  return process.env[keyFor(prefix, target, arch)] || process.env[prefix];
}

// L7: Semver-ish validation — accept digits-and-dots only before reflecting back.
const VERSION_RE = /^[\d]+\.[\d]+\.[\d]+/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { target, arch, current_version } = req.query;
  if (!VERSION_RE.test(current_version || ''))
    return res.status(400).json({ error: 'Invalid version format' });
  const version = valueFor('UPDATE_VERSION', target, arch);
  const url = valueFor('UPDATE_URL', target, arch);
  const signature = valueFor('UPDATE_SIGNATURE', target, arch);
  const notes = valueFor('UPDATE_NOTES', target, arch) || '';
  const pubDate = valueFor('UPDATE_PUB_DATE', target, arch) || new Date().toISOString();

  if (!version || !url || !signature) {
    return res.status(200).json({
      version: current_version,
      notes: '',
      pub_date: new Date().toISOString(),
      platforms: {},
    });
  }

  return res.status(200).json({
    version,
    pub_date: pubDate,
    url,
    signature,
    notes,
  });
}
