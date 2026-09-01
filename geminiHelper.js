const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { getCvText } = require('./aiScore');
const { getLearnedAnswer, saveLearnedAnswer } = require('./learnedAnswers');

let aiClients = [];
let activeKeyIndex = 0;
let cvTextCached = null;

// Read config
let config = {};
try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let keys = [];
    if (Array.isArray(config.geminiApiKeys)) {
      keys = config.geminiApiKeys.filter(k => typeof k === 'string' && k.trim().length > 0);
    }
    if (keys.length === 0 && config.geminiApiKey && config.geminiApiKey.trim().length > 0) {
      keys = [config.geminiApiKey.trim()];
    }

    if (keys.length > 0) {
      aiClients = keys.map(k => new GoogleGenAI({ apiKey: k }));
      console.log(`✅ Gemini AI initialized with ${aiClients.length} API key(s)! Brain power upgraded.`);
    } else {
      console.log("⚠️ No valid geminiApiKey found in config.json. Running in fallback mode.");
    }
  } else {
    console.log("⚠️ config.json not found. Running in fallback mode.");
  }
} catch (err) {
  console.warn("Could not read config.json in geminiHelper:", err.message);
}

function getActiveAi() {
  if (aiClients.length === 0) return null;
  return aiClients[activeKeyIndex];
}

function rotateApiKey() {
  if (aiClients.length > 1) {
    activeKeyIndex = (activeKeyIndex + 1) % aiClients.length;
    console.log(`🔄 Rotated Gemini API Key to key #${activeKeyIndex + 1} of ${aiClients.length}`);
  }
}

/**
 * Core AI agent to read questions and answer them carefully according to CV context and overrides.
 * If a validation error is present, Gemini analyzes the error context and adjusts the answer accordingly.
 * @param {Object} params
 * @param {string} params.questionText - The text of the question
 * @param {string} params.inputType - The type of input ('text', 'number', 'radio', 'select', etc.)
 * @param {string[]} params.options - Optional array of options (for select, radio, dropdowns)
 * @param {string} params.validationError - Optional validation error message from previous submission/attempt
 * @returns {Promise<string>} The answered text/choice
 */
async function getSmartAnswer({ questionText, inputType, options = [], validationError = '' }) {
  // Check memory database first (only if no validation error is present)
  if (!validationError) {
    const cachedAns = getLearnedAnswer(questionText, inputType, options);
    if (cachedAns) {
      console.log(`🧠 [Local Memory Match] Found saved answer: "${cachedAns}"`);
      return cachedAns;
    }
  }

  const q = questionText.toLowerCase();
  const defaultAnswers = config.defaultAnswers || {};

  // 1. AI Decision Engine (Highest Priority when AI is enabled)
  let currentAi = getActiveAi();
  if (currentAi) {
    try {
      if (!cvTextCached) {
        cvTextCached = await getCvText().catch(() => '');
      }

      const optionsStr = options.length > 0 
        ? `Available Options (you MUST select exactly one of these):\n${options.map(o => `- "${o}"`).join('\n')}`
        : '';

      let errorContext = '';
      if (validationError && validationError.trim().length > 0) {
        errorContext = `
🚨 FORM SUBMISSION VALIDATION ERROR DETECTED ON THIS FIELD:
"${validationError.trim()}"

CRITICAL INSTRUCTION FOR ERROR RECOVERY:
- The candidate's previous response triggered the form validation error shown above.
- Analyze WHY the validation failed (e.g., format mismatch, text provided instead of number, value out of allowed range, missing required option, special characters not allowed).
- Adjust and return a REVISED answer that strictly satisfies the form validation rule while remaining accurate and ATS-friendly for the candidate.
`;
      } else if (q.includes('validation error:')) {
        errorContext = `
🚨 FORM SUBMISSION VALIDATION ERROR DETECTED:
- Read the validation error message embedded in the question text.
- Analyze WHY the validation failed and provide a revised answer that strictly satisfies the form rules.
`;
      }

      const prompt = `
You are an AI assistant helping to auto-fill a job application for a candidate.
The job application is asking the following question:
"${questionText}"

Expected Answer Type: ${inputType}
${optionsStr}
${errorContext}

Candidate Profile Overrides (config.json defaultAnswers):
${JSON.stringify(defaultAnswers, null, 2)}

Candidate's Resume/CV text:
${cvTextCached || 'Not available'}

Your task is to provide the best and most appropriate answer to the question based on the candidate's resume, profile overrides, and the question context.

Instructions:
- Read the question and any validation errors extremely carefully.
- If a form validation error is reported, prioritize fixing the answer format or value so the form can be submitted successfully.
- First, check if the Candidate Profile Overrides (config.json defaultAnswers) contains a direct preference for the specific topic or skill asked in the question (e.g. current ctc, expected ctc, notice period, location, years of experience with a specific programming language/technology). Prioritize this override if it exists and satisfies validation rules.
- If there is no specific override, look for details in the candidate's Resume/CV text. For example, if asked about years of experience with a technology, calculate the years based on the resume history.
- If the answer cannot be found in the overrides or the resume, intelligently estimate the safest and most positive standard ATS-friendly answer.
- If this is a radio button or dropdown/select/option question, you MUST select EXACTLY one option from the list of "Available Options" above. Return only that option name. Do not modify the option text.
- If it is a numeric question, return only the number (e.g. "3" or "30").
- If it is a text question, write a concise, professional, and truthful answer (1-3 sentences maximum).
- DO NOT wrap the output in quotes, markdown, or explain your reasoning. Output ONLY the raw final answer.
`;

      let response = null;
      try {
        response = await currentAi.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
      } catch (err) {
        if (err.message && err.message.includes('429')) {
          rotateApiKey();
        }
        console.warn(`⚠️ [Gemini AI] API limit reached (${err.message.includes('429') ? 'Rate limit 429' : err.message}). Instantly using saved auto-answer defaults.`);
      }

      if (response && response.text) {
        const aiAnswer = response.text.trim().replace(/^["']|["']$/g, '');
        console.log(`[Gemini AI] Question: "${questionText}"${validationError ? ` (Error: "${validationError}")` : ''} -> Answer: "${aiAnswer}"`);
        
        let finalAns = aiAnswer;
        if (options.length > 0) {
          // Exact match
          const exactMatch = options.find(o => o.toLowerCase() === aiAnswer.toLowerCase());
          if (exactMatch) {
            finalAns = exactMatch;
          } else {
            // Partial/Contain match
            const partialMatch = options.find(o => 
              o.toLowerCase().includes(aiAnswer.toLowerCase()) || 
              aiAnswer.toLowerCase().includes(o.toLowerCase())
            );
            if (partialMatch) {
              finalAns = partialMatch;
            } else {
              finalAns = options[0];
            }
          }
        }
        
        // Save the successfully generated answer to local memory
        if (!validationError) {
          saveLearnedAnswer(questionText, inputType, options, finalAns);
        }
        return finalAns;
      }
    } catch (e) {
      console.warn("⚠️ [Gemini AI] Instantly using saved auto-answer defaults.");
    }
  }

  // 2. Direct Config Override Check (Fallback when AI is disabled/failed)
  const sortedKeys = Object.keys(defaultAnswers).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (q.includes(key.toLowerCase())) {
      const ans = defaultAnswers[key];
      // If we have options, find the best match amongst options
      if (options.length > 0) {
        const matchedOpt = options.find(opt => 
          opt.toLowerCase() === ans.toLowerCase() || 
          opt.toLowerCase().includes(ans.toLowerCase()) || 
          ans.toLowerCase().includes(opt.toLowerCase())
        );
        if (matchedOpt) return matchedOpt;
      } else {
        return ans;
      }
    }
  }

  // 3. Fallback Heuristic Engine with Error Sanitization
  let fallbackAnswer = '';

  if (options.length > 0) {
    if (q.includes('disability')) {
      const noOpt = options.find(o => o.toLowerCase().includes('no') || o.toLowerCase().includes("don't have") || o.toLowerCase().includes("do not have"));
      if (noOpt) fallbackAnswer = noOpt;
    } else if (q.includes('gender') || q.includes('sex')) {
      const maleOpt = options.find(o => o.toLowerCase() === 'male' || o.toLowerCase().includes('male'));
      if (maleOpt) fallbackAnswer = maleOpt;
    } else if (q.includes('veteran')) {
      const noOpt = options.find(o => o.toLowerCase().includes('no') || o.toLowerCase().includes('not a veteran'));
      if (noOpt) fallbackAnswer = noOpt;
    } else if (q.includes('sponsor')) {
      const noOpt = options.find(o => o.toLowerCase() === 'no' || o.toLowerCase().startsWith('no'));
      if (noOpt) fallbackAnswer = noOpt;
    } else if (q.includes('authoriz') || q.includes('eligible')) {
      const yesOpt = options.find(o => o.toLowerCase() === 'yes' || o.toLowerCase().startsWith('yes'));
      if (yesOpt) fallbackAnswer = yesOpt;
    }

    if (!fallbackAnswer) {
      const yesOpt = options.find(o => o.toLowerCase() === 'yes' || o.toLowerCase().startsWith('yes'));
      fallbackAnswer = yesOpt ? yesOpt : options[0];
    }
  } else if (q.includes('notice')) {
    fallbackAnswer = defaultAnswers['notice period'] || '30';
  } else if (q.includes('current') && (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package'))) {
    fallbackAnswer = defaultAnswers['current ctc'] || '450000';
  } else if (q.includes('expected') || q.includes('expect') || q.includes('salary') || q.includes('compensation') || q.includes('package')) {
    fallbackAnswer = defaultAnswers['expected ctc'] || '1200000';
  } else if (q.includes('cgpa') || q.includes('gpa') || q.includes('percentage') || q.includes('marks') || q.includes('score')) {
    fallbackAnswer = defaultAnswers['cgpa'] || '7.54';
  } else if (q.includes('phone') || q.includes('mobile') || q.includes('contact')) {
    fallbackAnswer = defaultAnswers['phone'] || '8260960591';
  } else if (inputType === 'number' || q.includes('years') || q.includes('experience') || q.includes('how many')) {
    fallbackAnswer = defaultAnswers['experience'] || '3';
  }

  // Sanitize fallback answer if validation error requires digits only
  const errLower = (validationError || '').toLowerCase();
  if (errLower.includes('number') || errLower.includes('digit') || errLower.includes('integer') || errLower.includes('numeric')) {
    const digitsOnly = String(fallbackAnswer).replace(/\D/g, '');
    if (digitsOnly.length > 0) return digitsOnly;
  }

  return fallbackAnswer;
}

module.exports = {
  getSmartAnswer
};
