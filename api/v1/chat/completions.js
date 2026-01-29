// api/v1/chat/completions.js - FIXED TIMEOUT VERSION
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',
  'gpt-4': 'deepseek-ai/deepseek-v3.2',
  'gpt-4-turbo': 'z-ai/glm4.7',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'meta/llama-3.1-70b-instruct',
  'gemini-pro': 'meta/llama-3.1-8b-instruct'
};

// CRITICAL: Strict timeout - MUST be less than Vercel's limit
const TIMEOUT_MS = 20000; // 20 seconds (well under 300s limit)

export default async function handler(req, res) {
  const startTime = Date.now();
  
  // Set response timeout header
  res.setHeader('X-Timeout-MS', TIMEOUT_MS);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({
      error: {
        message: 'Method not allowed',
        type: 'invalid_request_error'
      }
    });
  }

  if (!NIM_API_KEY) {
    console.error('❌ No API key');
    return res.status(200).json({
      error: {
        message: 'API key not configured',
        type: 'server_error'
      }
    });
  }

  try {
    const { model, messages, temperature, max_tokens } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(200).json({
        error: {
          message: 'Invalid messages',
          type: 'invalid_request_error'
        }
      });
    }

    // Limit messages and tokens aggressively
    const limitedMessages = messages.slice(-8); // Only last 8 messages
    const requestModel = model || 'gpt-3.5-turbo';
    const nimModel = MODEL_MAPPING[requestModel] || 'meta/llama-3.1-8b-instruct';
    const optimizedMaxTokens = Math.min(max_tokens || 800, 1024); // Even smaller!
    
    console.log(`📨 Request: ${requestModel} -> ${nimModel}, tokens: ${optimizedMaxTokens}`);
    
    const nimRequest = {
      model: nimModel,
      messages: limitedMessages,
      temperature: temperature !== undefined ? temperature : 0.7,
      top_p: 0.9,
      max_tokens: optimizedMaxTokens,
      stream: false
    };
    
    console.log(`🚀 Calling NVIDIA...`);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error(`⏰ TIMEOUT after ${TIMEOUT_MS}ms`);
      controller.abort();
    }, TIMEOUT_MS);
    
    let response;
    try {
      response = await fetch(`${NIM_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(nimRequest),
        signal: controller.signal
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error(`❌ Request aborted after ${TIMEOUT_MS}ms`);
        return res.status(200).json({
          error: {
            message: `Request timeout after ${TIMEOUT_MS/1000}s. Try: 1) Use gpt-3.5-turbo model, 2) Shorter messages, 3) Check NVIDIA status`,
            type: 'timeout_error'
          }
        });
      }
      throw fetchError;
    }
    
    clearTimeout(timeoutId);
    
    const elapsed = Date.now() - startTime;
    console.log(`📡 Response: ${response.status} in ${elapsed}ms`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ NVIDIA error ${response.status}:`, errorText.substring(0, 100));
      
      if (response.status === 429) {
        return res.status(200).json({
          error: {
            message: 'Rate limit. Wait 60s and try again.',
            type: 'rate_limit_error'
          }
        });
      }
      
      if (response.status === 401) {
        return res.status(200).json({
          error: {
            message: 'Invalid API key',
            type: 'authentication_error'
          }
        });
      }
      
      return res.status(200).json({
        error: {
          message: `NVIDIA API error: ${response.status}`,
          type: 'api_error'
        }
      });
    }
    
    const data = await response.json();
    
    if (!data.choices?.[0]?.message?.content) {
      console.error('❌ Invalid response structure');
      return res.status(200).json({
        error: {
          message: 'Invalid response from NVIDIA',
          type: 'api_error'
        }
      });
    }
    
    const content = data.choices[0].message.content;
    const totalTime = Date.now() - startTime;
    
    console.log(`✅ Success in ${totalTime}ms, ${content.length} chars`);
    
    return res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: 'stop'
      }],
      usage: data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ Error after ${totalTime}ms:`, error.message);
    
    return res.status(200).json({
      error: {
        message: error.message || 'Internal error',
        type: 'server_error'
      }
    });
  }
}
