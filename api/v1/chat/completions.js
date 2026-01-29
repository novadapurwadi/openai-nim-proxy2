// api/v1/chat/completions.js - HIDE REASONING, SHOW ONLY RESULT
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',
  'gpt-4': 'z-ai/glm4.7',
  'gpt-4-turbo': 'z-ai/glm4.7',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'deepseek-ai/deepseek-v3.1',
  'claude-3-sonnet': 'z-ai/glm4.7',
  'gemini-pro': 'meta/llama-3.1-8b-instruct'
};

const TIMEOUT_MS = 180000;

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
    
    // SMART CONTENT EXTRACTION - Hide reasoning, show only final result
    let content = '';
    let hasReasoning = false;
    let hasContent = false;
    
    // Check what's available
    if (choice.message?.content && choice.message.content !== null && choice.message.content !== '') {
      // Regular content exists and is not null/empty
      content = choice.message.content;
      hasContent = true;
      console.log('✅ Using message.content (final answer)');
    } else if (choice.message?.reasoning_content) {
      // Only reasoning available, content is null
      hasReasoning = true;
      
      // Try to extract final answer from reasoning
      const reasoning = choice.message.reasoning_content;
      
      // Look for common patterns where models put final answer
      // Pattern 1: After "Final Answer:" or similar
      const finalAnswerMatch = reasoning.match(/(?:Final Answer|Answer|Result|Output):\s*(.+)/is);
      if (finalAnswerMatch) {
        content = finalAnswerMatch[1].trim();
        console.log('✅ Extracted final answer from reasoning');
      } else {
        // Pattern 2: Last paragraph/section (often the conclusion)
        const lines = reasoning.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
          // Take last 3 lines as likely the final answer
          content = lines.slice(-3).join('\n').trim();
          console.log('✅ Using last section of reasoning as answer');
        } else {
          // Fallback: use all reasoning (not ideal but better than nothing)
          content = reasoning;
          console.log('⚠️ Using full reasoning_content (no clear answer found)');
        }
      }
    } else if (choice.text) {
      content = choice.text;
      console.log('✅ Using choice.text');
    } else if (choice.message?.text) {
      content = choice.message.text;
      console.log('✅ Using message.text');
    }
    
    // Log what we found
    if (hasContent && hasReasoning) {
      console.log('ℹ️ Model returned both content and reasoning (using content)');
    } else if (hasReasoning && !hasContent) {
      console.log('ℹ️ Model returned only reasoning (extracted answer)');
    }
    
    if (!content) {
      console.error('❌ No content found');
      console.error('Choice structure:', JSON.stringify(choice).substring(0, 500));
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
