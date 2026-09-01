const { chromium } = require('playwright');
const fs = require('fs');
const { calculateMatchScore } = require('./aiScore');
const { getSmartAnswer } = require('./geminiHelper');
const { generateHtmlReport } = require('./generateReport');
const { buildCustomResume } = require('./latexResumeBuilder');

// Read config
let config = {};
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (err) {
  console.error('Error reading config.json:', err.message);
  process.exit(1);
}

async function fillFieldHumanized(input, answer) {
  if (config.humanizeBehaviors) {
    try {
      await input.click();
      await input.press('Control+A');
      await input.press('Backspace');
      await input.pressSequentially(answer, { delay: Math.floor(Math.random() * 50) + 50 });
      return;
    } catch (e) {
      try {
        await input.type(answer, { delay: Math.floor(Math.random() * 50) + 50 });
        return;
      } catch (e2) {}
    }
  }
  await input.fill(answer).catch(() => {});
}

let appliedCount = 0;
let maxApplications = config.maxApplications || 25;

const APPLIED_JOBS_FILE = 'applied_jobs.json';
let appliedJobs = [];
try {
  if (fs.existsSync(APPLIED_JOBS_FILE)) {
    appliedJobs = JSON.parse(fs.readFileSync(APPLIED_JOBS_FILE, 'utf8'));
  }
} catch (err) {
  console.warn('Error reading applied_jobs.json, starting clean:', err.message);
}

function saveAppliedJob(jobId, title, company, probability = null, matchingSkills = [], missingSkills = [], description = '') {
  if (!jobId) return;
  if (!appliedJobs.some(j => j.jobId === jobId)) {
    appliedJobs.push({
      jobId,
      title: title ? title.trim() : 'Unknown',
      company: company ? company.trim() : 'Unknown',
      probability: probability,
      matchingSkills: matchingSkills,
      missingSkills: missingSkills,
      aiAnalysis: description || '',
      timestamp: new Date().toISOString()
    });
    try {
      fs.writeFileSync(APPLIED_JOBS_FILE, JSON.stringify(appliedJobs, null, 2), 'utf8');
      console.log(`Saved job ID ${jobId} to applied_jobs.json`);
    } catch (err) {
      console.error('Error saving applied jobs database:', err.message);
    }
  }
}

function getSmartFallbackAnswer(questionText, inputType) {
  const q = questionText.toLowerCase();
  
  if (q.includes('current') && (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package'))) {
    return config.defaultAnswers['current ctc'] || '450000';
  }
  if ((q.includes('expected') || q.includes('expect')) && (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package'))) {
    return config.defaultAnswers['expected ctc'] || '1200000';
  }
  if (q.includes('notice')) {
    return config.defaultAnswers['notice period'] || '30';
  }
  if (q.includes('cgpa') || q.includes('gpa') || q.includes('percentage') || q.includes('marks') || q.includes('score')) {
    return config.defaultAnswers['cgpa'] || '7.54';
  }
  if (q.includes('location') || q.includes('city') || q.includes('live') || q.includes('reside') || q.includes('address')) {
    return 'Paradeep, Odisha';
  }
  
  const isNumeric = inputType === 'number' || q.includes('years') || q.includes('experience') || q.includes('how many');
  if (isNumeric) return '2';
  
  return 'Yes';
}

async function getQuestionText(iframe, elementLocator) {
  // Try to find label using 'for' attribute
  const id = await elementLocator.getAttribute('id').catch(()=>null);
  if (id) {
    const label = iframe.locator(`label[for="${id}"]`);
    if (await label.count() > 0) {
      const text = await label.first().innerText();
      if (text) return text.trim();
    }
  }
  
  // Try to find closest ancestor question label
  const questionText = await elementLocator.evaluate((el) => {
    let parent = el.closest('fieldset, .ia-Questions-item, .ia-FormGroup, div');
    while (parent) {
      const labelEl = parent.querySelector('label, legend, h3, .ia-FormLabel');
      if (labelEl) {
        return labelEl.innerText.trim();
      }
      parent = parent.parentElement;
    }
    return '';
  }).catch(()=>'');
  
  return questionText;
}

async function fillFieldsOnCurrentScreen(page, iframe) {
  console.log('Filling fields on current Indeed modal screen using Gemini AI...');
  
  // 1. Text Inputs & Textareas
  const textInputs = iframe.locator('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], textarea');
  const textCount = await textInputs.count();
  for (let i = 0; i < textCount; i++) {
    const input = textInputs.nth(i);
    if (!(await input.isVisible().catch(()=>false))) continue;
    
    const currentValue = await input.inputValue().catch(()=>'');
    if (currentValue && currentValue.trim() !== '') continue;
    
    const questionText = await getQuestionText(iframe, input);
    console.log(`- Found Text Input. Question: "${questionText}"`);
    
    const type = await input.getAttribute('type').catch(()=>'text') || 'text';
    const answer = await getSmartAnswer({
      questionText,
      inputType: type
    });
    
    console.log(`  Filling with: "${answer}"`);
    await fillFieldHumanized(input, answer);

    // Auto-select dropdown if typing a location
    if (questionText.toLowerCase().includes('location') || questionText.toLowerCase().includes('city')) {
        await page.waitForTimeout(1500);
        try {
            const options = await page.$$('li, [role="option"], [id*="typeahead"] li, .typeahead li, [role="listbox"] li');
            for (const opt of options) {
                const text = await opt.innerText();
                if (text.toLowerCase().includes('kujang') || text.toLowerCase().includes('paradeep')) {
                    await opt.click();
                    console.log(`  Selected dropdown option: "${text.trim()}"`);
                    break;
                }
            }
        } catch (e) {
            console.log("  Could not select dropdown:", e.message);
        }
    }
  }
  
  // 2. Select Dropdowns
  const selects = iframe.locator('select');
  const selCount = await selects.count();
  for (let i = 0; i < selCount; i++) {
    const select = selects.nth(i);
    if (!(await select.isVisible().catch(()=>false))) continue;
    
    const questionText = await getQuestionText(iframe, select);
    console.log(`- Found Dropdown. Question: "${questionText}"`);
    
    const options = await select.locator('option').evaluateAll(opts => opts.map(o => ({ value: o.value, text: o.text.trim() })));
    const optionTexts = options.map(o => o.text).filter(t => t.length > 0 && !t.toLowerCase().includes('select') && !t.toLowerCase().includes('choose'));
    
    const targetText = await getSmartAnswer({
      questionText,
      inputType: 'select',
      options: optionTexts
    });
    
    const bestOpt = options.find(o => o.text.toLowerCase() === targetText.toLowerCase() || o.text.toLowerCase().includes(targetText.toLowerCase()) || targetText.toLowerCase().includes(o.text.toLowerCase()));
    const selectedValue = bestOpt ? bestOpt.value : (options.find(o => o.value !== '') || options[0])?.value;
    
    if (selectedValue) {
      console.log(`  Selected option value: "${selectedValue}" (matched text: "${targetText}")`);
      await select.selectOption(selectedValue).catch(()=>{});
    }
  }
  
  // 3. Radio buttons
  const radios = iframe.locator('input[type="radio"]');
  const radioCount = await radios.count();
  const radioGroups = {};
  for (let i = 0; i < radioCount; i++) {
    const radio = radios.nth(i);
    const name = await radio.getAttribute('name').catch(()=>null);
    if (name) {
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(radio);
    }
  }
  
  for (const name of Object.keys(radioGroups)) {
    const group = radioGroups[name];
    let alreadyChecked = false;
    for (const radio of group) {
      if (await radio.isChecked().catch(()=>false)) { alreadyChecked = true; break; }
    }
    if (alreadyChecked) continue;
    
    const questionText = await getQuestionText(iframe, group[0]);
    console.log(`- Found Radio Group. Question: "${questionText}"`);
    
    const optionLabels = [];
    const radioElements = [];
    for (const radio of group) {
      const id = await radio.getAttribute('id').catch(()=>null);
      let labelText = '';
      if (id) {
        const labelEl = iframe.locator(`label[for="${id}"]`).first();
        if (await labelEl.count() > 0) labelText = await labelEl.innerText();
      }
      if (!labelText) labelText = await radio.evaluate(el => el.nextElementSibling ? el.nextElementSibling.innerText : '').catch(()=>'');
      labelText = labelText.trim();
      if (labelText) {
        optionLabels.push(labelText);
        radioElements.push({ radio, labelText });
      }
    }
    
    const targetText = await getSmartAnswer({
      questionText,
      inputType: 'radio',
      options: optionLabels
    });
    
    console.log(`  Selected radio option: "${targetText}"`);
    
    let clicked = false;
    const targetObj = radioElements.find(re => re.labelText.toLowerCase() === targetText.toLowerCase() || re.labelText.toLowerCase().includes(targetText.toLowerCase()) || targetText.toLowerCase().includes(re.labelText.toLowerCase()));
    
    if (targetObj) {
      await targetObj.radio.check({ force: true }).catch(()=>{});
      clicked = true;
    }
    
    if (!clicked && group.length > 0) {
      await group[0].check({ force: true }).catch(()=>{});
    }
  }
  
  // 4. File uploads (Resume)
  const fileInputs = iframe.locator('input[type="file"]');
  const fileCount = await fileInputs.count();
  for (let i = 0; i < fileCount; i++) {
    const fileInput = fileInputs.nth(i);
    if (await fileInput.isVisible().catch(()=>false) || await fileInput.evaluate(e => e.type === 'file').catch(()=>false)) {
      if (config.resumePath && fs.existsSync(config.resumePath)) {
        console.log(`- Found File Upload. Uploading resume: ${config.resumePath}`);
        try {
          await fileInput.setInputFiles(config.resumePath);
          await page.waitForTimeout(1000);
        } catch (err) {
          console.warn(`  Failed to upload resume: ${err.message}`);
        }
      }
    }
  }
}

async function handleIndeedModal(page) {
  console.log('Handling Indeed Apply Modal...');
  const maxSteps = 10;
  let step = 0;
  
  // Locate Indeed Apply iframe
  // Indeed sometimes nests iframes or uses a specific title
  let iframeLocator = page.frameLocator('iframe[title*="Indeed"], iframe[name^="indeedapply"]');
  
  // Wait for iframe to be ready
  await page.waitForTimeout(2000);
  
  while (step < maxSteps) {
    step++;
    console.log(`Processing Indeed modal screen step ${step}...`);
    
    // Check if iframe still exists
    const iframeExists = await page.$('iframe[title*="Indeed"], iframe[name^="indeedapply"]').catch(()=>null);
    if (!iframeExists) {
      console.log('Iframe no longer found. Modal might be closed.');
      break;
    }
    
    await fillFieldsOnCurrentScreen(page, iframeLocator);
    
    // Look for continue/submit buttons
    const nextBtn = iframeLocator.locator('button:has-text("Continue"), button:has-text("Review"), button:has-text("Next")').first();
    const submitBtn = iframeLocator.locator('button:has-text("Submit application"), button:has-text("Apply")').first();
    const returnBtn = iframeLocator.locator('button:has-text("Return to job search")').first();
    
    if (await returnBtn.count() > 0 && await returnBtn.isVisible().catch(()=>false)) {
      console.log('Success screen detected! "Return to job search" button found.');
      await returnBtn.click({ force: true }).catch(()=>{});
      return true;
    }
    
    if (await submitBtn.count() > 0 && await submitBtn.isVisible().catch(()=>false)) {
      console.log('Found Submit button! Submitting application...');
      await submitBtn.click({ force: true }).catch(()=>{});
      
      // Wait for success
      try {
        await page.waitForFunction(() => {
          const doc = document.querySelector('iframe[title*="Indeed"]')?.contentDocument || document;
          return doc.body.innerText.includes('submitted') || doc.body.innerText.includes('applied');
        }, {}, { timeout: 15000 });
        console.log('Application submitted successfully!');
        
        // Try to close modal
        const closeBtn = page.locator('button[aria-label="Close"]').first();
        if (await closeBtn.count() > 0) await closeBtn.click().catch(()=>{});
        return true;
      } catch (e) {
        // If timeout, check if it's still open
        console.log('Timeout waiting for success message, assuming success if modal closed.');
        const stillOpen = await page.$('iframe[title*="Indeed"]').catch(()=>null);
        if (!stillOpen) return true;
      }
    } else if (await nextBtn.count() > 0 && await nextBtn.isVisible().catch(()=>false)) {
      console.log('Clicking Next/Continue...');
      await nextBtn.click({ force: true }).catch(()=>{});
      await page.waitForTimeout(2000);
    } else {
      console.log('No actionable buttons found. Waiting for manual intervention...');
      await page.waitForTimeout(10000); // Wait for user to maybe click something manually
    }
  }
  return false;
}

async function applyToAllJobsOnPage(page) {
  console.log('Scrolling job list to load all items...');
  // Indeed results are usually a ul
  let cards = await page.$$('.job_seen_beacon, ul.jobsearch-ResultsList > li:not(.mosaic-provider-jobcards-provider)');
  
  const priorityKeywords = config.priorityKeywords || ["product"];
  const blacklistKeywords = config.blacklistKeywords || [];

  const priorityIndices = [];
  const otherIndices = [];
  for (let i = 0; i < cards.length; i++) {
    try {
      const card = cards[i];
      const titleEl = await card.$('.jobTitle, h2.jobTitle');
      const jobTitle = titleEl ? await titleEl.innerText() : 'Unknown Title';
      
      // Blacklist filter
      const isBlacklisted = blacklistKeywords.some(kw => new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(jobTitle));
      if (isBlacklisted) {
        console.log(`Skipping Blacklisted Role on Indeed: "${jobTitle.trim()}"`);
        continue;
      }
      
      const isPriority = priorityKeywords.some(kw => new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(jobTitle));
      if (isPriority) {
        priorityIndices.push(i);
      } else {
        otherIndices.push(i);
      }
    } catch (e) {
      otherIndices.push(i);
    }
  }
  const sortedIndices = [...priorityIndices, ...otherIndices];
  console.log(`Prioritizing ${priorityIndices.length} priority jobs out of ${cards.length} total on this page.`);
  
  for (let idx = 0; idx < sortedIndices.length; idx++) {
    const i = sortedIndices[idx];
    if (appliedCount >= maxApplications) {
      console.log('Reached maximum applications limit. Stopping.');
      break;
    }
    
    console.log(`----------------------------------------`);
    console.log(`Processing Job Card ${idx + 1} of ${sortedIndices.length} (Original Card Index: ${i})`);
    
    const card = cards[i];
    
    // Extract Job Title
    const titleEl = await card.$('.jobTitle, h2.jobTitle');
    const jobTitle = titleEl ? await titleEl.innerText() : 'Unknown Title';
    
    // Extract Company
    const companyEl = await card.$('.companyName, [data-testid="company-name"]');
    const company = companyEl ? await companyEl.innerText() : 'Unknown Company';
    
    // Extract ID
    const linkEl = await card.$('a[data-jk], a[id^="job_"]');
    const jobId = linkEl ? await linkEl.getAttribute('data-jk') : `indeed_${Date.now()}_${i}`;
    
    if (jobId && appliedJobs.some(j => j.jobId === jobId)) {
      console.log(`Job: "${jobTitle.trim()}" at "${company.trim()}" (ID: ${jobId}) has already been applied or skipped in this session/database. Skipping.`);
      continue;
    }
    
    await card.scrollIntoViewIfNeeded().catch(()=>{});
    await page.waitForTimeout(500);
    
    console.log(`Job: "${jobTitle.trim()}" at "${company.trim()}" (ID: ${jobId || 'N/A'})`);
    
    try {
      await card.click();
      await page.waitForTimeout(2000);
    } catch (e) {
      console.error('Failed to click job card:', e.message);
      continue;
    }
    
    // Check right pane for "Apply now"
    const applyBtn = await page.$('#indeedApplyButton');
    
    let matchScore = null;
    let matchingSkills = [];
    let missingSkills = [];
    let matchDescription = '';
    try {
        const descLoc = await page.locator('#jobDescriptionText').first();
        if (await descLoc.count() > 0) {
            const descText = await descLoc.innerText();
            console.log('Calculating Match Probability using Gemini AI...');
            const matchResult = await calculateMatchScore(descText, jobTitle);
            if (matchResult !== null) {
                matchScore = matchResult.score;
                matchingSkills = matchResult.matchingSkills;
                missingSkills = matchResult.missingSkills;
                matchDescription = matchResult.description || '';
                console.log(`Match Probability: ${matchScore}%`);
                console.log(`Matching Skills: ${matchingSkills.join(', ') || 'None'}`);
                console.log(`Missing Skills: ${missingSkills.join(', ') || 'None'}`);
                if (matchDescription) console.log(`AI Analysis: ${matchDescription}`);
            }
        }
    } catch (err) {
        console.error('Error calculating Match Probability:', err.message);
    }
    
    if (matchScore !== null && matchScore < (config.minMatchScoreToApply || 45)) {
      console.log(`⏭️ Match score (${matchScore}%) is below minimum threshold (${config.minMatchScoreToApply || 45}%). Skipping job.`);
      if (jobId) {
        saveAppliedJob(jobId, jobTitle, company, matchScore, matchingSkills, missingSkills, `Skipped: Match score too low - ${matchDescription}`);
      }
      continue;
    }
    
    if (config.jitResumeCustomization) {
      try {
        const descLoc = await page.locator('#jobDescriptionText').first();
        if (await descLoc.count() > 0) {
            const descText = await descLoc.innerText();
            console.log(`🛠️ Tailoring resume for "${jobTitle.trim()}" at "${company.trim()}"...`);
            await buildCustomResume(jobTitle, company, descText);
        }
      } catch (err) {
        console.warn(`Failed to dynamically tailor resume: ${err.message}. Using default.`);
      }
    }

    if (applyBtn) {
      console.log('Apply with Indeed button found! Clicking...');
      try {
        await applyBtn.click({ timeout: 5000, force: true });
        await page.waitForTimeout(2500);
      } catch (e) {
        console.warn(`Failed to click Indeed Apply button: ${e.message}. Skipping...`);
        if (jobId) saveAppliedJob(jobId, jobTitle, company, matchScore, matchingSkills, missingSkills, matchDescription);
        continue;
      }
      
      const success = await handleIndeedModal(page);
      if (success) {
        appliedCount++;
        console.log(`Applied successfully! Total applications: ${appliedCount}`);
        if (jobId) {
          saveAppliedJob(jobId, jobTitle, company, matchScore, matchingSkills, missingSkills, matchDescription);
        }
      } else {
        console.log('Failed or skipped this application.');
        // close modal if stuck
        const closeBtn = await page.$('button[aria-label="Close"], .ia-TopHeader-closeBtn');
        if (closeBtn) await closeBtn.click().catch(()=>{});
      }
    } else {
      console.log('Apply with Indeed button not found (might be external or already applied). Skipping.');
      if (jobId) {
        saveAppliedJob(jobId, jobTitle, company, matchScore, matchingSkills, missingSkills, matchDescription);
      }
    }
    
    await page.waitForTimeout(1000);
  }
}

async function run() {
  console.log('Launching browser for Indeed...');
  
  const browser = await chromium.launch({
    headless: config.headless !== undefined ? config.headless : false,
    slowMo: 100,
    args: ['--start-maximized']
  });
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];
  const selectedUA = config.rotateUserAgents ? userAgents[Math.floor(Math.random() * userAgents.length)] : undefined;
  if (selectedUA) {
    console.log(`🤖 Using Rotated User-Agent: "${selectedUA}"`);
  }

  const contextOptions = {
    viewport: null,
    userAgent: selectedUA
  };
  const hasIndeedState = fs.existsSync('indeed_state.json');
  if (hasIndeedState) {
    contextOptions.storageState = 'indeed_state.json';
    console.log('Using saved Indeed session from indeed_state.json...');
  } else {
    console.log('No saved Indeed session found. Starting fresh browser context.');
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  console.log(`Navigating to target URL: ${config.targetUrl}`);
  try {
    await page.goto(config.targetUrl, { waitUntil: 'commit', timeout: 60000 });
  } catch (e) {
    console.warn(`Navigation warning/timeout: ${e.message}. Proceeding anyway...`);
  }
  
  // Check for Cloudflare / Human Verification
  console.log('Checking for human verification challenges...');
  await page.waitForTimeout(2000);
  const isChallenge = await page.title().then(t => t.toLowerCase().includes('just a moment') || t.toLowerCase().includes('cloudflare') || t.toLowerCase().includes('attention required')).catch(()=>false);
  const hasChallengeIframe = await page.locator('iframe[title*="Cloudflare"], iframe[title*="security challenge"]').count() > 0;
  
  if (isChallenge || hasChallengeIframe) {
    console.log('Human verification detected! Attempting to auto-click the checkbox...');
    try {
      const cfCheckbox = page.frameLocator('iframe[title*="Cloudflare"], iframe[title*="security challenge"]').locator('input[type="checkbox"]');
      if (await cfCheckbox.count() > 0) {
        await page.waitForTimeout(1000);
        await cfCheckbox.click({ force: true });
        console.log('Clicked verification checkbox!');
      }
    } catch (e) {}

    console.log('Waiting up to 5 minutes for verification to complete (you may need to manually click/solve it in the browser window)...');
    try {
      await page.waitForFunction(() => {
        return !document.title.toLowerCase().includes('just a moment') && 
               !document.title.toLowerCase().includes('cloudflare') &&
               !document.querySelector('iframe[title*="Cloudflare"]');
      }, {}, { timeout: 300000 });
      console.log('Verification passed!');
    } catch(e) {
      console.warn('Verification wait timed out. Proceeding anyway...');
    }
  }
  
  console.log('Waiting for Indeed jobs list to load...');
  await page.waitForTimeout(5000); // Give it time to load the SPA
  
  // Check if user needs to log in
  const signinBtn = await page.$('a[href*="account/login"], a:has-text("Sign in")');
  if (signinBtn || page.url().includes('account/login')) {
    console.log('You are not logged in or were redirected to the login screen. Please log in directly in the browser window.');
    if (signinBtn && !page.url().includes('account/login')) {
      console.log('Clicking the Sign in button to open the login page for you...');
      await signinBtn.click({ force: true }).catch(() => {});
    }
    if (process.send) {
      process.send({
        type: 'intervention-required',
        questionText: 'Indeed Sign In Required: Please complete the login challenge in the browser window. Once logged in successfully, click Resume in the dashboard.',
        inputType: 'manual-action',
        options: []
      });
      console.log('⏳ Waiting for user to complete Indeed login via Web dashboard...');
      await new Promise((resolve) => {
        const handler = (msg) => {
          if (msg && msg.type === 'intervention-response') {
            process.off('message', handler);
            resolve();
          }
        };
        process.on('message', handler);
      });
    } else {
      console.log('Waiting up to 5 minutes for successful login...');
      try {
        await page.waitForFunction(() => {
          // Wait until the sign in link is no longer present
          const hasSignInLink = Array.from(document.querySelectorAll('a')).some(a => a.innerText.toLowerCase().includes('sign in') || a.href.includes('account/login'));
          return !hasSignInLink || window.location.href.includes('vjk=');
        }, {}, { timeout: 300000 });
        console.log('Login detected! Saving session for future runs...');
      } catch (e) {
        console.warn('Warning: Login timed out. Proceeding anyway...');
      }
    }
  }

  // Save state occasionally in case of manual login
  await context.storageState({ path: 'indeed_state.json' }).catch(() => {});
  
  let hasNextPage = true;
  while (hasNextPage && appliedCount < maxApplications) {
    await applyToAllJobsOnPage(page);
    
    if (appliedCount >= maxApplications) break;
    
    console.log('Navigating to the next page of results...');
    const nextBtn = await page.$('a[data-testid="pagination-page-next"]');
    
    if (nextBtn) {
      try {
        await nextBtn.scrollIntoViewIfNeeded().catch(()=>{});
        await nextBtn.click({ force: true });
        console.log('Waiting for next page results to load...');
        await page.waitForTimeout(5000);
      } catch (e) {
        console.log(`Failed to click next page: ${e.message}`);
        hasNextPage = false;
      }
    } else {
      console.log('No Next button found. Reached the end of search results.');
      hasNextPage = false;
    }
  }
  
  console.log(`\nAutomation complete. Applied to ${appliedCount} jobs.`);
  generateHtmlReport();
  await browser.close();
}

run().catch(err => {
  console.error('An error occurred during Indeed automation:', err);
});
