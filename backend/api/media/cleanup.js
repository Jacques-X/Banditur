import { createClient } from '@supabase/supabase-js';
import { cors } from '../cors.js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

function validUploadPath(path) {
  return typeof path === 'string'
    && path.startsWith('uploads/')
    && !path.includes('..');
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const paths = Array.isArray(req.body?.paths)
    ? req.body.paths.filter(validUploadPath).slice(0, 100)
    : [];

  if (!paths.length) return res.status(200).json({ removed: 0 });

  const { data, error } = await sb.storage.from('media').remove(paths);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ removed: data?.length ?? paths.length });
}
