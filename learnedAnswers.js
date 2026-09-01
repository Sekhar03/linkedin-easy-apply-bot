const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'learned_answers.json');

function loadAnswers() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('Error reading learned_answers.json:', e.message);
  }
  return [];
}

function saveAnswers(answers) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(answers, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing learned_answers.json:', e.message);
  }
}

function cleanString(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getLearnedAnswer(questionText, inputType, options = []) {
  const answers = loadAnswers();
  const cleanQ = cleanString(questionText);
  if (!cleanQ) return null;

  for (const entry of answers) {
    const cleanEntryQ = cleanString(entry.question);
    
    // Check if the questions match exactly, or one contains the other
    if (cleanQ === cleanEntryQ || cleanQ.includes(cleanEntryQ) || cleanEntryQ.includes(cleanQ)) {
      // Check options compatibility if applicable
      if (options.length > 0 && entry.options && entry.options.length > 0) {
        const match = options.find(o => o.toLowerCase() === entry.answer.toLowerCase() || o.toLowerCase().includes(entry.answer.toLowerCase()) || entry.answer.toLowerCase().includes(o.toLowerCase()));
        if (match) return match;
      } else {
        return entry.answer;
      }
    }
  }
  return null;
}

function saveLearnedAnswer(questionText, inputType, options = [], answer) {
  if (!questionText || !answer) return;
  const answers = loadAnswers();
  const cleanQ = cleanString(questionText);

  // Avoid duplicates
  const exists = answers.some(entry => cleanString(entry.question) === cleanQ);
  if (!exists) {
    answers.push({
      question: questionText.trim(),
      inputType,
      options,
      answer: answer.trim(),
      timestamp: new Date().toISOString()
    });
    saveAnswers(answers);
    console.log(`💾 Saved learned answer for: "${questionText.trim()}" -> "${answer.trim()}"`);
  }
}

module.exports = {
  getLearnedAnswer,
  saveLearnedAnswer
};
