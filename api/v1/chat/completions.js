// api/v1/chat/completions.js - FIXED FOR REASONING_CONTENT
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',
  'gpt-4': 'z-ai/glm4.7',
  'gpt-4-turbo': 'z-ai/glm4.7',
  'gpt-4o': 'deepseek-ai/deepseek-v3.2',
  'claude-3-opus': 'deepseek-ai/deepseek-v3.1',
  'claude-3-sonnet': 'z-ai/glm4.7',
  'gemini-pro': 'meta/llama-3.1-8b-instruct'
};

const TIMEOUT_MS = 180000; // 3 minutes

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
    
    let limitedMessages, optimizedMaxTokens;
    
    if (nimModel.includes('z-ai') || nimModel.includes('deepseek')) {
      limitedMessages = messages.slice(-4);
      optimizedMaxTokens = Math.min(max_tokens || 512, 1024);
      console.log(`🧠 INTELLIGENT MODEL: ${nimModel}`);
    } else {
      limitedMessages = messages.slice(-10);
      optimizedMaxTokens = Math.min(max_tokens || 1024, 2048);
      console.log(`⚡ FAST MODEL: ${nimModel}`);
    }
    
    console.log(`📨 ${requestModel} -> ${nimModel}`);
    console.log(`📊 Messages: ${messages.length} -> ${limitedMessages.length}`);
    console.log(`🎯 Tokens: ${optimizedMaxTokens}`);
    
    const nimRequest = {
      model: nimModel,
      messages: limitedMessages,
      temperature: temperature !== undefined ? temperature : 0.7,
      top_p: 0.9,
      max_tokens: optimizedMaxTokens,
      stream: false
    };
    
    console.log(`🚀 Calling NVIDIA...`);
    
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
        console.error(`❌ Timeout after ${elapsed}ms`);
        return res.status(200).json({
          error: {
            message: `Timeout after ${Math.floor(elapsed/1000)}s. Clear chat history and try again.`,
            type: 'timeout_error'
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
      console.error(`❌ NVIDIA error ${response.status}:`, errorText.substring(0, 200));
      
      if (response.status === 429) {
        return res.status(200).json({
          error: { message: 'Rate limit exceeded. Wait 2-3 minutes.', type: 'rate_limit_error' }
        });
      }
      
      if (response.status === 401) {
        return res.status(200).json({
          error: { message: 'Invalid API key', type: 'authentication_error' }
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
      console.error('❌ No choices');
      return res.status(200).json({
        error: { message: 'Invalid response - no choices', type: 'api_error' }
      });
    }
    
    const choice = data.choices[0];
    
    // FIXED: Extract from reasoning_content OR regular content
    let content = 
      choice.message?.content ||
      choice.message?.reasoning_content ||  // ✅ THIS IS THE FIX!
      choice.text ||
      choice.message?.text ||
      choice.delta?.content ||
      choice.content ||
      '';
    
    if (choice.message?.reasoning_content) {
      console.log('✅ Using reasoning_content');
    } else if (choice.message?.content) {
      console.log('✅ Using message.content');
    }
    
    if (!content) {
      console.error('❌ No content found');
      return res.status(200).json({
        error: { message: 'Empty response', type: 'empty_response_error' }
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
    console.error(`❌ Exception:`, error.message);
    return res.status(200).json({
      error: { message: error.message || 'Internal error', type: 'server_error' }
    });
  }
}
