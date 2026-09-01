const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');

// Helper to escape LaTeX special characters
function escapeLatex(text) {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/([&%$#_{}])/g, '\\$1')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/</g, '\\textless{}')
        .replace(/>/g, '\\textgreater{}')
        .replace(/\r?\n/g, ' ');
}

// Call Gemini API to optimize resume
function callGemini(apiKey, prompt) {
    return new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const body = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        const text = parsed.candidates[0].content.parts[0].text;
                        resolve(JSON.parse(text));
                    } catch (e) {
                        reject(new Error(`Failed to parse Gemini response: ${e.message}. Raw: ${data}`));
                    }
                } else {
                    reject(new Error(`Gemini API returned status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Generate LaTeX string from resume JSON
function generateLatexContent(data) {
    const name = escapeLatex(data.name || 'Candidate');
    const contact = escapeLatex(data.contact || '');
    const summary = escapeLatex(data.summary || '');

    let skillsHtml = '';
    if (data.skills) {
        for (const [category, list] of Object.entries(data.skills)) {
            if (list && list.length > 0) {
                const escapedCategory = escapeLatex(category);
                const escapedList = list.map(escapeLatex).join(', ');
                skillsHtml += `\\item \\textbf{${escapedCategory}:} ${escapedList}\n`;
            }
        }
    }

    let expHtml = '';
    if (data.experience) {
        for (const exp of data.experience) {
            const company = escapeLatex(exp.company);
            const role = escapeLatex(exp.role);
            const date = escapeLatex(exp.date);
            expHtml += `\\textbf{${company}} \\hfill ${date} \\\\\n`;
            expHtml += `\\textit{${role}} \\\\\n`;
            if (exp.bullets && exp.bullets.length > 0) {
                expHtml += `\\begin{itemize}[leftmargin=*,noitemsep,topsep=2pt]\n`;
                for (const b of exp.bullets) {
                    expHtml += `    \\item ${escapeLatex(b)}\n`;
                }
                expHtml += `\\end{itemize}\n`;
            }
            expHtml += `\\vspace{6pt}\n`;
        }
    }

    let projHtml = '';
    if (data.projects) {
        for (const proj of data.projects) {
            const title = escapeLatex(proj.title);
            const date = escapeLatex(proj.date);
            projHtml += `\\textbf{${title}} \\hfill ${date} \\\\\n`;
            if (proj.bullets && proj.bullets.length > 0) {
                projHtml += `\\begin{itemize}[leftmargin=*,noitemsep,topsep=2pt]\n`;
                for (const b of proj.bullets) {
                    projHtml += `    \\item ${escapeLatex(b)}\n`;
                }
                projHtml += `\\end{itemize}\n`;
            }
            projHtml += `\\vspace{6pt}\n`;
        }
    }

    let eduHtml = '';
    if (data.education) {
        for (const edu of data.education) {
            const inst = escapeLatex(edu.institution);
            const deg = escapeLatex(edu.degree);
            const date = escapeLatex(edu.date);
            const details = edu.details ? ` | ${escapeLatex(edu.details)}` : '';
            eduHtml += `\\textbf{${inst}} \\hfill ${date} \\\\\n`;
            eduHtml += `\\textit{${deg}${details}} \\\\\n\\vspace{4pt}\n`;
        }
    }

    let achHtml = '';
    if (data.achievements && data.achievements.length > 0) {
        achHtml += `\\begin{itemize}[leftmargin=*,itemsep=0pt]\n`;
        for (const ach of data.achievements) {
            achHtml += `    \\item ${escapeLatex(ach)}\n`;
        }
        achHtml += `\\end{itemize}\n`;
    }

    return `\\documentclass[10pt,letterpaper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[left=0.75in,right=0.75in,top=0.6in,bottom=0.6in]{geometry}
\\usepackage{hyperref}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage{color}

\\definecolor{darkblue}{rgb}{0,0,0.5}
\\hypersetup{colorlinks=true, linkcolor=darkblue, urlcolor=darkblue}

\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{10pt}{5pt}

\\pagestyle{empty}

\\begin{document}
\\begin{center}
    {\\LARGE \\bf ${name}} \\\\
    \\vspace{4pt}
    ${contact}
\\end{center}

\\section{Summary}
${summary}

\\section{Skills}
\\begin{itemize}[leftmargin=*,itemsep=0pt]
${skillsHtml}\\end{itemize}

\\section{Experience}
${expHtml}
\\section{Projects}
${projHtml}
\\section{Education}
${eduHtml}
\\section{Achievements}
${achHtml}

\\end{document}`;
}

// Main logic
async function buildCustomResume(jobTitle, company, jobDescription) {
    console.log(`\n--- Dynamic LaTeX Resume Builder ---`);
    console.log(`Target: ${jobTitle} at ${company}`);

    const masterPath = 'C:\\Users\\sekha\\OneDrive\\Desktop\\resume builder\\master_resume.json';
    if (!fs.existsSync(masterPath)) {
        throw new Error(`Master resume not found at: ${masterPath}`);
    }
    const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

    // Read config from current folder (EASY APPLY)
    const configPath = path.join(__dirname, 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error('Error reading config.json:', e.message);
        }
    }
    const apiKey = config.geminiApiKey || 'AIzaSyB2AnY1weCncy4cp_zN41qMTBnIcDaizfE';
    const finalResumePath = config.resumePath || 'C:\\Users\\sekha\\OneDrive\\Desktop\\resume builder\\Generated_Resumes\\Tenarai\\Resume_Tenarai_SoftwareEngineer_2026-07-15.pdf';

    let resumeData = masterData;

    if (jobDescription && jobDescription.trim().length > 0) {
        console.log('Optimizing resume content via Gemini...');
        const prompt = `
You are an expert ATS Resume Writer and Technical Recruiter.
Your task is to generate a highly ATS-friendly resume tailored to the target Job Description.

Target Role: ${jobTitle}
Target Company: ${company}

Job Description:
${jobDescription}

Candidate Master Resume Data:
${JSON.stringify(masterData, null, 2)}

ATS RULES:
1. TRUTHFULNESS: Never fabricate, invent, or exaggerate any skills, experience, projects, certifications, or employment history. You may ONLY rewrite existing content, reorder information, highlight relevant experience, optimize keywords, improve bullet points, improve formatting, and rearrange projects based on relevance.
2. SUMMARY: Rewrite the professional summary (3-5 lines) specifically for this role, mentioning relevant technologies, domain strengths, and most relevant achievements from the master resume.
3. SKILLS: Group and reorder the candidate's actual skills into logical categories. Prioritize the most relevant skills first based on the Job Description. Remove empty categories.
4. EXPERIENCE: Tailor the candidate's existing experience bullets using strong action verbs (Designed, Architected, Shipped, Developed, Optimized, etc.) and include quantifiable metrics where available. Emphasize keywords from the JD (like state management, asynchronous processing, scaling, etc.) only if supported by the master resume.
5. PROJECTS: Rank projects by relevance to the JD. Tailor project bullets to highlight matching technologies.

Return ONLY a valid JSON object matching the Candidate Master Resume Data schema:
{
  "name": "Candidate Full Name",
  "contact": "Contact details",
  "summary": "Tailored summary text...",
  "skills": {
    "Category1": ["Skill1", "Skill2", ...],
    "Category2": [...]
  },
  "experience": [
    {
      "company": "Company Name",
      "role": "Role Title",
      "date": "Date Range",
      "bullets": [
        "Tailored bullet point...",
        "Another tailored bullet..."
      ]
    }
  ],
  "projects": [
    {
      "title": "Project Title",
      "date": "Project type/date",
      "bullets": [
        "Tailored project bullet..."
      ]
    }
  ],
  "education": [
    {
      "institution": "University/School",
      "degree": "Degree and Major",
      "date": "Graduation Date/Range",
      "details": "CGPA: 7.54"
    }
  ],
  "achievements": [
    "Achievement 1..."
  ]
}
`;
        try {
            resumeData = await callGemini(apiKey, prompt);
            console.log('Gemini optimization successful.');
        } catch (e) {
            console.error('Gemini optimization failed. Falling back to master resume data.', e.message);
            resumeData = masterData;
        }
    } else {
        console.log('No job description provided. Generating generic resume from master data.');
    }

    // Generate LaTeX source code
    console.log('Generating LaTeX source code...');
    const latexCode = generateLatexContent(resumeData);
    
    const tempDir = path.join(__dirname, 'temp_build');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    const texFile = path.join(tempDir, 'resume.tex');
    fs.writeFileSync(texFile, latexCode, 'utf8');

    // Compile with Tectonic
    console.log('Compiling LaTeX via Tectonic...');
    const tectonicPath = 'C:\\Users\\sekha\\OneDrive\\Desktop\\resume builder\\bin\\tectonic.exe';
    
    return new Promise((resolve, reject) => {
        const proc = spawn(tectonicPath, ['--outdir', tempDir, texFile]);
        
        proc.stdout.on('data', (data) => {
            console.log(`[Tectonic] ${data.toString().trim()}`);
        });

        proc.stderr.on('data', (data) => {
            console.warn(`[Tectonic Warning/Error] ${data.toString().trim()}`);
        });

        proc.on('close', (code) => {
            if (code === 0) {
                const tempPdf = path.join(tempDir, 'resume.pdf');
                if (fs.existsSync(tempPdf)) {
                    // Make sure output folder for final pdf exists
                    const finalPdfDir = path.dirname(finalResumePath);
                    if (!fs.existsSync(finalPdfDir)) {
                        fs.mkdirSync(finalPdfDir, { recursive: true });
                    }
                    // Copy to config.resumePath location
                    fs.copyFileSync(tempPdf, finalResumePath);
                    console.log(`SUCCESS: Custom resume compiled & copied to: ${finalResumePath}`);
                    resolve(finalResumePath);
                } else {
                    reject(new Error('Tectonic finished but PDF was not generated.'));
                }
            } else {
                reject(new Error(`Tectonic compilation failed with exit code: ${code}`));
            }
        });
    });
}

module.exports = {
    buildCustomResume
};
