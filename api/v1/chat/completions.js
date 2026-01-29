// api/v1/chat/completions.js - OPTIMIZED FOR SLOW INTELLIGENT MODELS
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// Your required intelligent models
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',     // Fast fallback
  'gpt-4': 'z-ai/glm4.7',                            // High intelligence
  'gpt-4-turbo': 'z-ai/glm4.7',                      // High intelligence
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',             // High intelligence
  'claude-3-opus': 'deepseek-ai/deepseek-v3.1',      // High intelligence
  'claude-3-sonnet': 'z-ai/glm4.7',                  // High intelligence
  'gemini-pro': 'meta/llama-3.1-8b-instruct'         // Fast fallback
};

const TIMEOUT_MS = 180000; // 180 seconds (3 minutes) for very slow models

export default async function handler(req, res) {
  const startTime = Date.now();
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({
      error: { message: 'Method not allowed', type: 'invalid_request_error' }
    });
  }

  if (!NIM_API_KEY) {
    console.error('❌ No API key');
    return res.status(200).json({
      error: { message: 'API key not configured', type: 'server_error' }
    });
  }

  try {
    const { model, messages, temperature, max_tokens } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(200).json({
        error: { message: 'Invalid messages', type: 'invalid_request_error' }
      });
    }

    const requestModel = model || 'gpt-4o';
    const nimModel = MODEL_MAPPING[requestModel] || 'deepseek-ai/deepseek-v3.1';
    
    // EXTREME optimization for intelligent models
    let limitedMessages, optimizedMaxTokens;
    
    if (nimModel.includes('z-ai') || nimModel.includes('deepseek')) {
      // For GLM 4.7 and DeepSeek: VERY aggressive limits
      limitedMessages = messages.slice(-4);  // Only last 4 messages (2 turns)
      optimizedMaxTokens = Math.min(max_tokens || 300, 512); // Max 512 tokens
      console.log(`🧠 INTELLIGENT MODEL: ${nimModel} (will be slow)`);
    } else {
      // For fast models: normal limits
      limitedMessages = messages.slice(-10);
      optimizedMaxTokens = Math.min(max_tokens || 1024, 2048);
      console.log(`⚡ FAST MODEL: ${nimModel}`);
    }
    
    console.log(`📨 ${requestModel} -> ${nimModel}`);
    console.log(`📊 Messages: ${messages.length} -> ${limitedMessages.length}`);
    console.log(`🎯 Max tokens: ${optimizedMaxTokens}`);
    console.log(`⏱️ Timeout: ${TIMEOUT_MS/1000}s`);
    
    const nimRequest = {
      model: nimModel,
      messages: limitedMessages,
      temperature: temperature !== undefined ? temperature : 0.7,
      top_p: 0.9,
      max_tokens: optimizedMaxTokens,
      stream: false
    };
    
    console.log(`🚀 [${Date.now() - startTime}ms] Calling NVIDIA... (this may take 30-120s)`);
    
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
        console.error(`❌ TIMEOUT after ${elapsed}ms`);
        return res.status(200).json({
          error: {
            message: `Model ${nimModel} timed out after ${Math.floor(elapsed/1000)}s. This is a very slow model. Please: 1) Clear chat history in Janitor AI, 2) Keep messages shorter, 3) Wait patiently (can take 2-3 minutes)`,
            type: 'timeout_error',
            elapsed_seconds: Math.floor(elapsed/1000),
            model: nimModel
          }
        });
      }
      throw fetchError;
    }
    
    clearTimeout(timeoutId);
    
    const elapsed = Date.now() - startTime;
    console.log(`📡 [${elapsed}ms] Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ NVIDIA error ${response.status}:`, errorText.substring(0, 200));
      
      if (response.status === 429) {
        return res.status(200).json({
          error: {
            message: 'Rate limit exceeded. Wait 2-3 minutes before trying again.',
            type: 'rate_limit_error'
          }
        });
      }
      
      if (response.status === 401) {
        return res.status(200).json({
          error: {
            message: 'Invalid API key. Check your NVIDIA API key.',
            type: 'authentication_error'
          }
        });
      }
      
      return res.status(200).json({
        error: {
          message: `NVIDIA API error: ${response.status}`,
          type: 'api_error',
          details: errorText.substring(0, 200)
        }
      });
    }
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0]) {
      console.error('❌ No choices in response');
      console.error('Response:', JSON.stringify(data).substring(0, 500));
      return res.status(200).json({
        error: {
          message: 'Invalid response from NVIDIA - no choices',
          type: 'api_error'
        }
      });
    }
    
    const choice = data.choices[0];
    
    // Extract content with all possible fallbacks
    let content = 
      choice.message?.content ||
      choice.text ||
      choice.message?.text ||
      choice.delta?.content ||
      choice.content ||
      '';
    
    if (!content) {
      console.error('❌ No content in response');
      console.error('Choice structure:', JSON.stringify(choice).substring(0, 500));
      return res.status(200).json({
        error: {
          message: 'Empty response from model',
          type: 'empty_response_error'
        }
      });
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ SUCCESS in ${totalTime}ms (${Math.floor(totalTime/1000)}s)`);
    console.log(`📝 Response: ${content.length} characters`);
    
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
    console.error(`❌ Exception after ${totalTime}ms:`, error.message);
    return res.status(200).json({
      error: {
        message: error.message || 'Internal error',
        type: 'server_error'
      }
    });
  }
}
