const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const cvText = `Sekhar Parida
SKILLS: Python, JavaScript, TypeScript, C++
System Design and Backend: System Architecture, Microservices, Async Processing (WebSocket/Workflows), REST API Design, Node.js, Database Design
Databases: PostgreSQL, MySQL, MongoDB
Tools and DevOps: Playwright, Docker, Postman, Git, GitHub, JIRA, CI/CD Pipelines
Methodologies: Rapid Prototyping, Agile/Scrum, Product Ownership, Defect Triage
FinTech and Payments: Chargeback Management, Visa RDR, Transaction Operations, Bharat Connect/BBPS, POS/MATM/AEPS
Experience: Product Engineer at iServeU (Mar 2026-Present), Full Stack Developer at Heroic Apparel (May 2024-Feb 2025), Web Developer at Svapak (Jun 2023-Jul 2024)
Projects: ThunderBird (Python, WebSocket, React.js, Docker, Quantum-secured sat-comm), ID Card System (MongoDB, React.js, Node.js)
Education: B.Tech Electronics and Telecom, CGPA 7.54`;

const missingSkills = [
  'SQL (103 jobs)', 'AWS (101)', 'Azure (91)', 'Java (82)', 'Selenium (50)',
  'Machine Learning (49)', 'Google Cloud (43)', 'Jenkins (38)', 'Go (37)', 'Data Engineering (37)',
  'Kubernetes (32)', 'Linux (30)', 'Bash/Shell (25)', 'Angular (24)', 'C# (23)',
  'Kafka (21)', 'Django (19)', 'Spring Boot (19)', 'Computer Vision (18)', 'Oracle DB (17)',
  'Terraform (17)', 'Cypress (17)', 'SQL Server (16)', 'Algorithm Design (15)', 'Flask (15)',
  'OOP Design (14)', 'GraphQL (14)', 'Data Structures (13)', 'Express.js (12)', 'Next.js (12)',
  'Spark (11)', 'JUnit (10)', 'SASS/LESS (10)', 'Elasticsearch (10)', 'Redis (10)',
  'Unit Testing (10)', 'NLP (8)', 'Vue.js (8)', 'Ansible (7)', 'ASP.NET (7)',
  'Redux (6)', 'Jest (6)', 'Ruby on Rails (5)', 'Mocha (5)', 'Hadoop (5)',
  'Pandas (5)', 'System Architecture (5)', 'Ruby (4)', 'Deep Learning (4)',
  'TensorFlow (4)', 'PyTorch (4)', 'Tailwind CSS (4)', 'Rust (3)', 'PHP (3)',
  'NumPy (3)', 'Swift (3)', 'Kotlin (3)', 'Cassandra (2)', 'Bootstrap (2)', 'Scikit-learn (1)'
];

const prompt = `
You are a senior tech career coach and resume expert.

Here is the candidate's current CV profile:
${cvText}

Here are the skills missing from their resume that employers are demanding (with how many jobs require them):
${missingSkills.join(', ')}

Your task:
Analyze each missing skill relative to the candidate's existing background. Group them into the following tech stacks and for each stack provide a prioritized list of skills to add to the CV, with:
1. The skill name
2. Relevance to existing skills (HIGH/MEDIUM/LOW based on how naturally it extends what they already have)
3. A short 1-sentence note on HOW they can demonstrate it on their CV
4. Whether it is already partially present but just not written on CV (true/false)

Tech Stacks to organize by:
1. Cloud and DevOps
2. Backend Development
3. Databases and Data
4. Frontend
5. Testing and QA
6. AI and ML
7. Languages and Core CS

Respond in clean JSON format like:
{
  "stacks": [
    {
      "name": "Cloud and DevOps",
      "skills": [
        {
          "skill": "AWS",
          "jobDemand": 101,
          "relevance": "HIGH",
          "alreadyPartial": false,
          "cvNote": "Get AWS Cloud Practitioner cert and add to Skills section; mention Docker experience as baseline."
        }
      ]
    }
  ]
}

Sort skills within each stack by jobDemand (highest first). Only include genuinely missing skills (not already in CV). Be honest about relevance.
Do NOT wrap in markdown. Return ONLY valid JSON.
`;

ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt })
  .then(r => {
    let raw = r.text.trim();
    raw = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    fs.writeFileSync('skill_analysis_result.json', raw, 'utf8');
    console.log('Done! Written to skill_analysis_result.json');
  })
  .catch(e => console.error('Error:', e.message));
