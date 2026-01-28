// api/index.js - Root endpoint
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  res.status(200).json({
    status: 'online',
    service: 'OpenAI-NVIDIA NIM Proxy',
    endpoints: {
      health: '/api/health',
      models: '/api/models', 
      chat: '/api/chat',
      v1_chat: '/v1/chat/completions',
      v1_models: '/v1/models'
    },
    timestamp: new Date().toISOString()
  });
}
