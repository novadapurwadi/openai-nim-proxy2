// api/health.js
export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy (Vercel)',
    timestamp: new Date().toISOString()
  });
}
