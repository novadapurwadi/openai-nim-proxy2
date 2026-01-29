// api/v1/chat/completions.js - OPTIMIZED FOR Z-AI & DEEPSEEK
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// YOUR REQUIRED MODELS - Optimized settings
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'deepseek-ai/deepseek-v3.2',
  'gpt-4-turbo': 'z-ai/glm4.7',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking'
};

// CRITICAL: Higher timeout for slower models
const TIMEOUT_MS = 50000; // 50 seconds (for Z-AI and DeepSeek)

export default async function handler(req, res) {
  const startTime = Date.now();
  
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

    const requestModel = model || 'gpt-3.5-turbo';
    const nimModel = MODEL_MAPPING[requestModel] || 'meta/llama-3.1-8b-instruct';
    
    // OPTIMIZATION: Reduce context for slower models
    let limitedMessages;
    let optimizedMaxTokens;
    
    if (nimModel.includes('deepseek') || nimModel.includes('z-ai')) {
      // For slow models: aggressive optimization
      limitedMessages = messages.slice(-6);  // Only last 6 messages
      optimizedMaxTokens = Math.min(max_tokens || 512, 800); // Max 800 tokens
      console.log(`🐢 SLOW MODEL detected: ${nimModel}`);
    } else {
      // For fast models: normal limits
      limitedMessages = messages.slice(-10);
      optimizedMaxTokens = Math.min(max_tokens || 1024, 2048);
      console.log(`⚡ FAST MODEL detected: ${nimModel}`);
    }
    
    console.log(`📨 Request: ${requestModel} -> ${nimModel}`);
    console.log(`📊 Messages: ${messages.length} -> ${limitedMessages.length}, Tokens: ${optimizedMaxTokens}`);
    
    const nimRequest = {
      model: nimModel,
      messages: limitedMessages,
      temperature: temperature !== undefined ? temperature : 0.7,
      top_p: 0.9,
      max_tokens: optimizedMaxTokens,
      stream: false
    };
    
    console.log(`🚀 [${Date.now() - startTime}ms] Calling NVIDIA...`);
    
    // Abort controller with longer timeout
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
        const elapsed = Date.now() - startTime;
        console.error(`❌ Timeout after ${elapsed}ms for model: ${nimModel}`);
        return res.status(200).json({
          error: {
            message: `Model ${nimModel} timed out after ${elapsed}ms. This model is very slow. Try: 1) Keep messages short, 2) Clear chat history in Janitor AI, 3) Wait and retry.`,
            type: 'timeout_error',
            code: 'model_timeout',
            model: nimModel
          }
        });
      }
      throw fetchError;
    }
    
    clearTimeout(timeoutId);
    
    const elapsed = Date.now() - startTime;
    console.log(`📡 [${elapsed}ms] Response: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Error ${response.status}:`, errorText.substring(0, 100));
      
      if (response.status === 429) {
        return res.status(200).json({
          error: {
            message: 'Rate limit exceeded. Wait 60 seconds.',
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
          type: 'api_error',
          details: errorText.substring(0, 100)
        }
      });
    }
    
    const data = await response.json();
    
    // Validate response
    if (!data.choices || !data.choices[0]) {
      console.error('❌ Invalid response structure');
      return res.status(200).json({
        error: {
          message: 'Invalid response from NVIDIA',
          type: 'api_error'
        }
      });
    }
    
    // Extract content with multiple fallbacks
    let content = '';
    const choice = data.choices[0];
    
    if (choice.message?.content) {
      content = choice.message.content;
    } else if (choice.text) {
      content = choice.text;
    } else if (choice.message?.text) {
      content = choice.message.text;
    }
    
    if (!content) {
      console.error('❌ No content found in response');
      return res.status(200).json({
        error: {
          message: 'Empty response from model',
          type: 'api_error'
        }
      });
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Success in ${totalTime}ms - ${content.length} chars`);
    
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
        logprobs: null,
        finish_reason: choice.finish_reason || 'stop'
      }],
      usage: data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      system_fingerprint: null
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
