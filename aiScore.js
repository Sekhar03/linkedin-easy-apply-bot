const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

let cachedCvText = null;
let ai = null;

// --- Initialize Gemini AI ---
try {
  const { GoogleGenAI } = require('@google/genai');
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.geminiApiKey && config.geminiApiKey.trim().length > 0) {
      ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      console.log('✅ Gemini AI initialized for Match Score analysis.');
    } else {
      console.log('⚠️ No geminiApiKey in config.json. Match scoring will use keyword fallback.');
    }
  }
} catch (err) {
  console.warn('Could not initialize Gemini AI for aiScore:', err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill Ontology (used as FALLBACK only when Gemini AI is unavailable)
// ─────────────────────────────────────────────────────────────────────────────
const SKILL_ONTOLOGY = {
    // Languages
    "Python": ["python", "python3", "python2", "py"],
    "Java": ["java", "core java", "j2ee", "j2se"],
    "JavaScript": ["javascript", "js", "ecmascript", "es6", "vanilla js"],
    "TypeScript": ["typescript", "ts"],
    "C++": ["c++", "cpp", "c/c++"],
    "C#": ["c#", "c sharp", ".net c#"],
    "C": ["c programming", "c language", "c"],
    "Go": ["go", "golang"],
    "Rust": ["rust", "rustlang"],
    "Ruby": ["ruby", "ruby lang"],
    "PHP": ["php", "php7", "php8"],
    "Swift": ["swift", "swiftui"],
    "Kotlin": ["kotlin", "kt"],
    "Dart": ["dart"],
    // Front-End
    "React": ["react", "react.js", "reactjs", "react js", "react native"],
    "Angular": ["angular", "angular.js", "angularjs", "angular 2+"],
    "Vue.js": ["vue", "vue.js", "vuejs", "vue js"],
    "HTML/CSS": ["html", "html5", "css", "css3"],
    "SASS/LESS": ["sass", "less", "scss"],
    "Tailwind CSS": ["tailwind", "tailwindcss", "tailwind css"],
    "Bootstrap": ["bootstrap"],
    "Redux": ["redux", "redux toolkit"],
    "Next.js": ["next.js", "nextjs", "next js"],
    // Back-End
    "Node.js": ["node", "node.js", "nodejs", "node js"],
    "Express.js": ["express", "express.js", "expressjs"],
    "Django": ["django", "django rest framework", "drf"],
    "Flask": ["flask"],
    "Spring Boot": ["spring boot", "springboot", "spring-boot", "spring framework"],
    "ASP.NET": ["asp.net", ".net", ".net core", "asp.net core"],
    "Ruby on Rails": ["ruby on rails", "rails", "ror"],
    "GraphQL": ["graphql"],
    "REST APIs": ["rest", "rest api", "restful", "rest APIs"],
    "Microservices": ["microservices", "micro-services", "micro service"],
    // Databases
    "SQL": ["sql", "rdbms"],
    "MySQL": ["mysql", "my sql"],
    "PostgreSQL": ["postgresql", "postgres"],
    "Oracle DB": ["oracle", "oracle db"],
    "SQL Server": ["sql server", "mssql", "microsoft sql server"],
    "MongoDB": ["mongodb", "mongo", "mongo db"],
    "Cassandra": ["cassandra", "apache cassandra"],
    "Redis": ["redis"],
    "Elasticsearch": ["elasticsearch", "elastic search", "elk"],
    // DevOps & Cloud
    "AWS": ["aws", "amazon web services"],
    "Azure": ["azure", "microsoft azure"],
    "Google Cloud": ["gcp", "google cloud", "google cloud platform"],
    "Docker": ["docker", "containerization"],
    "Kubernetes": ["kubernetes", "k8s"],
    "Terraform": ["terraform", "iac", "infrastructure as code"],
    "Ansible": ["ansible"],
    "Jenkins": ["jenkins"],
    "Git/GitHub": ["git", "github", "gitlab", "bitbucket", "version control"],
    "CI/CD": ["ci/cd", "ci-cd", "continuous integration", "continuous deployment"],
    "Linux": ["linux", "ubuntu", "centos", "debian", "redhat", "unix"],
    "Bash/Shell": ["bash", "shell scripting", "shell", "unix shell"],
    // Testing
    "Selenium": ["selenium"],
    "Cypress": ["cypress"],
    "Playwright": ["playwright"],
    "Jest": ["jest"],
    "Mocha": ["mocha"],
    "JUnit": ["junit"],
    "Unit Testing": ["unit testing", "tdd", "test driven development"],
    "Postman": ["postman", "api testing"],
    // Data Science & ML
    "Machine Learning": ["machine learning", "ml"],
    "Deep Learning": ["deep learning", "dl"],
    "NLP": ["nlp", "natural language processing"],
    "Computer Vision": ["computer vision", "cv"],
    "TensorFlow": ["tensorflow", "tf"],
    "PyTorch": ["pytorch"],
    "Scikit-learn": ["scikit-learn", "sklearn"],
    "Pandas": ["pandas"],
    "NumPy": ["numpy"],
    "Data Engineering": ["data engineering", "etl", "data pipeline"],
    "Hadoop": ["hadoop"],
    "Spark": ["spark", "apache spark"],
    "Kafka": ["kafka", "apache kafka"],
    // Methodologies
    "Agile/Scrum": ["agile", "scrum", "kanban"],
    "JIRA": ["jira"],
    "System Architecture": ["system architecture", "software architecture", "solution architecture"],
    "Object-Oriented Design": ["object-oriented", "ood", "oop", "object oriented"],
    "Data Structures": ["data structures"],
    "Algorithm Design": ["algorithms", "algorithm design"]
};

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSkills(text, ontology) {
    const textLower = text.toLowerCase();
    const foundSkills = new Set();
    for (const [canonical, aliases] of Object.entries(ontology)) {
        for (const alias of aliases) {
            const aliasClean = alias.toLowerCase();
            let pattern;
            if (['c', 'c++', 'c#', 'go', 'r'].includes(aliasClean)) {
                pattern = new RegExp('(^|[^a-zA-Z0-9])' + escapeRegExp(aliasClean) + '([^a-zA-Z0-9]|$)', 'i');
            } else {
                pattern = new RegExp('\\b' + escapeRegExp(aliasClean) + '\\b', 'i');
            }
            if (pattern.test(textLower)) {
                foundSkills.add(canonical);
                break;
            }
        }
    }
    return Array.from(foundSkills);
}

// ─────────────────────────────────────────────────────────────────────────────
// getCvText: Reads & caches the candidate's CV/Resume as plain text
// ─────────────────────────────────────────────────────────────────────────────
async function getCvText() {
    if (cachedCvText) return cachedCvText;
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    } catch (err) {
        console.error('Error reading config.json for CV text:', err.message);
        return '';
    }
    const resumePath = config.resumePath;
    if (!resumePath || !fs.existsSync(resumePath)) {
        console.error(`CV file not found: ${resumePath}`);
        return '';
    }
    try {
        const dataBuffer = fs.readFileSync(resumePath);
        const data = await pdfParse(dataBuffer);
        cachedCvText = data.text;
        return cachedCvText;
    } catch (err) {
        console.error('Error parsing PDF:', err.message);
        return '';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateMatchScore: Uses Gemini AI for deep semantic analysis.
// Falls back to the keyword-matching ontology if AI is not configured.
// ─────────────────────────────────────────────────────────────────────────────
async function calculateMatchScore(jobDescription, jobTitle = '') {
    if (!jobDescription || jobDescription.trim() === '') return null;

    const cvText = await getCvText();
    if (!cvText) {
        console.warn('Could not extract CV text. Skipping match score computation.');
        return null;
    }

    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    } catch (e) {
        console.warn('Could not read config.json in aiScore:', e.message);
    }
    const priorityKeywords = config.priorityKeywords || ["product"];
    const priorityBonus = typeof config.priorityBonus === 'number' ? config.priorityBonus : 15;

    // ── 1. GEMINI AI ANALYSIS (primary) ──────────────────────────────────────
    if (ai) {
        try {
            const prompt = `
You are an expert ATS (Applicant Tracking System) analyst and career coach.

Your task is to deeply analyze the following Job Description against the Candidate's Resume/CV and produce a detailed match assessment.

=== JOB TITLE ===
${jobTitle || 'Not Specified'}

=== JOB DESCRIPTION ===
${jobDescription.substring(0, 8000)}

=== CANDIDATE'S RESUME/CV ===
${cvText.substring(0, 8000)}

=== INSTRUCTIONS ===
1. Read the job description carefully. Identify:
   - Required technical skills (languages, frameworks, tools, platforms)
   - Required soft skills and behaviors (communication, leadership, teamwork, etc.)
   - Required experience level (years of experience, domain expertise)
   - Required education/certifications
   - Role responsibilities and key deliverables

2. Cross-reference each requirement against the candidate's CV. For each:
   - Identify clearly matching skills/experiences (matchingSkills)
   - Identify important skills/requirements that the candidate is missing (missingSkills)

3. Compute an overall match score (0-100) that reflects:
   - Weight technical skill matches most heavily (~60%)
   - Weight experience level and domain fit (~25%)
   - Weight education, certifications, soft skills (~15%)
   - Apply a generous but realistic curve: if the candidate matches 60%+ of core technical requirements, the score should be at least 70.
   - **PRIORITIZE SPECIFIC ROLES**: The candidate is prioritizing specific roles. The job title is "${jobTitle}". The priority keywords list is: [${priorityKeywords.join(', ')}]. If the job title or description matches any of these keywords, apply a priority bonus of +${priorityBonus} points (up to a maximum cap of 100) to the final match score.

4. Write a short 1-2 sentence "description" summarizing how well the candidate fits the role and what the key deciding factor is.

=== OUTPUT FORMAT ===
Respond with ONLY valid JSON. No markdown, no code block, no explanation. Example:
{
  "score": 82,
  "matchingSkills": ["Node.js", "React", "MongoDB", "REST APIs", "Agile/Scrum"],
  "missingSkills": ["Kubernetes", "AWS certification"],
  "description": "Strong match for a full-stack Node.js/React role with solid REST API and MongoDB experience. The candidate lacks cloud infrastructure experience (Kubernetes/AWS), which is a nice-to-have for this role."
}
`;

            let response = null;
            try {
                response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                });
            } catch (err) {
                console.warn(`⚠️ [Gemini Match Score] AI rate limit hit or unavailable. Instantly falling back to keyword scoring.`);
            }

            if (response && response.text) {
                // Strip any accidental markdown fences
                let raw = response.text.trim();
                raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

                const parsed = JSON.parse(raw);
                const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
                const matchingSkills = Array.isArray(parsed.matchingSkills) ? parsed.matchingSkills : [];
                const missingSkills = Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [];
                const description = parsed.description || '';

                console.log(`[Gemini Match Score] Score: ${score}%`);
                console.log(`[Gemini Match Score] Matching: ${matchingSkills.join(', ') || 'None'}`);
                console.log(`[Gemini Match Score] Missing: ${missingSkills.join(', ') || 'None'}`);
                console.log(`[Gemini Match Score] Analysis: ${description}`);

                return { score, matchingSkills, missingSkills, description };
            }
        } catch (e) {
            console.error('Gemini match score analysis failed, falling back to keyword matching:', e.message);
        }
    }

    // ── 2. KEYWORD FALLBACK (when Gemini is unavailable) ─────────────────────
    console.log('Using keyword-based match score fallback...');
    try {
        const requiredSkills = extractSkills(jobDescription, SKILL_ONTOLOGY);
        if (requiredSkills.length === 0) {
            return { score: 50, matchingSkills: [], missingSkills: [], description: 'Unable to detect specific skills in the job description.' };
        }
        const candidateSkills = extractSkills(cvText, SKILL_ONTOLOGY);
        const matchingSkills = requiredSkills.filter(s => candidateSkills.includes(s));
        const missingSkills = requiredSkills.filter(s => !candidateSkills.includes(s));

        let score = 0;
        const totalRequired = requiredSkills.length;
        const totalMatched = matchingSkills.length;
        if (totalRequired <= 5) {
            score = (totalMatched / totalRequired) * 100;
        } else {
            const ratio = totalMatched / totalRequired;
            if (ratio >= 0.6) {
                score = 80 + ((ratio - 0.6) / 0.4) * 20;
            } else if (ratio >= 0.3) {
                score = 50 + ((ratio - 0.3) / 0.3) * 30;
            } else {
                score = (ratio / 0.3) * 50;
            }
        }
        
        // Prioritize specific roles with a score boost based on config
        const isPriorityRole = priorityKeywords.some(kw => {
            const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            return (jobTitle && regex.test(jobTitle)) || regex.test(jobDescription.substring(0, 1000));
        });
        if (isPriorityRole) {
            score += priorityBonus;
        }
        score = Math.min(100, Math.floor(score));
        
        const description = `Keyword-based match: ${totalMatched}/${totalRequired} required skills found in resume.${isPriorityRole ? ' (Priority Role Boost Applied)' : ''}`;
        return { score, matchingSkills, missingSkills, description };
    } catch (err) {
        console.error('Error in keyword fallback match scoring:', err.message);
        return null;
    }
}

module.exports = {
    calculateMatchScore,
    getCvText
};
