const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { calculateMatchScore } = require('./aiScore');
const { getSmartAnswer } = require('./geminiHelper');

// 1. Read Configuration
let config = {};
try {
  const configPath = path.join(__dirname, 'config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('✅ Loaded config.json successfully.');
} catch (err) {
  console.error('❌ Error reading config.json:', err.message);
  process.exit(1);
}

// Target Google Careers URL
const DEFAULT_TARGET_URL = 'https://www.google.com/about/careers/applications/jobs/saved?location=India&target_level=EARLY&target_level=INTERN_AND_APPRENTICE&degree=BACHELORS&employment_type=PART_TIME&employment_type=TEMPORARY&employment_type=INTERN&employment_type=FULL_TIME&sort_by=date&page=2';
const targetUrl = process.argv[2] || config.googleTargetUrl || DEFAULT_TARGET_URL;

const APPLIED_JOBS_FILE = path.join(__dirname, 'applied_jobs.json');
let appliedJobs = [];
try {
  if (fs.existsSync(APPLIED_JOBS_FILE)) {
    appliedJobs = JSON.parse(fs.readFileSync(APPLIED_JOBS_FILE, 'utf8'));
  }
} catch (err) {
  console.warn('⚠️ Error reading applied_jobs.json, starting clean database:', err.message);
}

function saveAppliedJob(jobId, title, company = 'Google', probability = null, matchingSkills = [], missingSkills = [], description = '') {
  if (!jobId) return;
  if (!appliedJobs.some(j => j.jobId === jobId)) {
    appliedJobs.push({
      jobId,
      title: title ? title.trim() : 'Google Job',
      company: company ? company.trim() : 'Google',
      probability: probability,
      matchingSkills: matchingSkills,
      missingSkills: missingSkills,
      aiAnalysis: description || '',
      timestamp: new Date().toISOString()
    });
    try {
      fs.writeFileSync(APPLIED_JOBS_FILE, JSON.stringify(appliedJobs, null, 2), 'utf8');
      console.log(`💾 Saved job ID ${jobId} ("${title}") to applied_jobs.json`);
    } catch (err) {
      console.error('❌ Error saving applied jobs database:', err.message);
    }
  }
}

/**
 * Smart Form Handler for Google Careers Application Form
 * Synchronized with exact recorded Playwright selectors from live application
 */
async function handleGoogleForm(page) {
  console.log('🤖 Processing Google Careers application form with exact recorded selectors...');
  
  let step = 0;
  const maxSteps = 12;

  while (step < maxSteps) {
    step++;
    console.log(`\n--- Processing Form Step ${step} ---`);
    await page.waitForTimeout(2500);

    // Check if application is already submitted / finished
    const pageText = await page.innerText('body').catch(() => '');
    if (
      pageText.toLowerCase().includes('application submitted') || 
      pageText.toLowerCase().includes('thank you for applying') ||
      pageText.toLowerCase().includes('your application has been sent') ||
      pageText.toLowerCase().includes('application received')
    ) {
      console.log('🎉 Application submission confirmed!');
      return true;
    }

    // A. Custom Google Material Dropdown (.VfPpkd-aPP78e / role="combobox")
    try {
      const customDropdowns = await page.$$('.VfPpkd-aPP78e, [role="combobox"], [role="listbox"]');
      for (const dd of customDropdowns) {
        if (await dd.isVisible().catch(() => false)) {
          console.log('  [Dropdown] Opening Material dropdown...');
          await dd.click().catch(() => {});
          await page.waitForTimeout(1000);
          
          // Select preferred location / option
          const targetOpt = page.getByRole('option', { name: /Bengaluru|India|Paradeep|Remote/i }).first();
          if (await targetOpt.isVisible().catch(() => false)) {
            await targetOpt.click();
          } else {
            const firstOpt = page.locator('[role="option"]').first();
            if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click();
          }
          await page.waitForTimeout(1000);
        }
      }
    } catch (e) {}

    // B. Standard Select Elements
    try {
      const selects = await page.$$('select');
      for (const select of selects) {
        if (!await select.isVisible().catch(() => false)) continue;
        const optionElements = await select.$$('option');
        const options = [];
        for (const opt of optionElements) {
          const text = await opt.innerText();
          if (text && text.trim()) options.push(text.trim());
        }
        if (options.length > 0) {
          const smartAns = await getSmartAnswer({ questionText: 'Location / Details', inputType: 'select', options: options });
          console.log(`  [Select] Choosing "${smartAns}"`);
          await select.selectOption({ label: smartAns }).catch(() => {});
        }
      }
    } catch (e) {}

    // C. Radio Buttons / Option Divs (Eligibility, Sponsorship, Gender, Disability, Veteran)
    try {
      // 1. Eligibility (Yes)
      const eligRadio = page.getByLabel(/legally eligible/i).locator('div').filter({ hasText: /^Yes$/ }).first();
      if (await eligRadio.isVisible().catch(() => false)) {
        console.log('  [Radio] Selecting Eligibility: Yes');
        await eligRadio.click().catch(() => {});
      }

      // 2. Sponsorship (No or Yes based on config)
      const sponsorText = (config.defaultAnswers && config.defaultAnswers.sponsorship === 'yes') ? 'Yes' : 'No';
      const sponsorRadio = page.getByLabel(/need work sponsor/i).getByText(sponsorText).first();
      if (await sponsorRadio.isVisible().catch(() => false)) {
        console.log(`  [Radio] Selecting Sponsorship: ${sponsorText}`);
        await sponsorRadio.click().catch(() => {});
      }

      // 3. Gender (Male)
      const genderRadio = page.getByRole('radio', { name: 'Male', exact: true });
      if (await genderRadio.isVisible().catch(() => false)) {
        console.log('  [Radio] Selecting Gender: Male');
        await genderRadio.check({ force: true }).catch(async () => {
          await page.locator('div').filter({ hasText: /^Male$/ }).first().click();
        });
      }

      // 4. Disability (No, I don't have a disability)
      const disText = page.getByText("No, I don't have a disability");
      if (await disText.isVisible().catch(() => false)) {
        console.log('  [Radio] Selecting Disability: No');
        await disText.click().catch(() => {});
      }

      // 5. Military / Veteran (No - I am not currently serving...)
      const milRadio = page.getByRole('radio', { name: /No - I am not currently/i });
      if (await milRadio.isVisible().catch(() => false)) {
        console.log('  [Radio] Selecting Veteran: No');
        await milRadio.check({ force: true }).catch(async () => {
          await page.locator('div').filter({ hasText: /^No - I am not currently serving/i }).first().click();
        });
      }

      // 6. Remaining Radio Groups
      const remainingRadios = await page.$$('input[type="radio"]:not(:checked)');
      for (const r of remainingRadios) {
        if (await r.isVisible().catch(() => false)) {
          await r.check({ force: true }).catch(() => {});
        }
      }
    } catch (e) {}

    // D. Checkboxes (Race/Ethnicity Asian, Consent, Certification)
    try {
      // Asian Race Checkbox
      const asianCb = page.getByRole('checkbox', { name: /Asian/i });
      if (await asianCb.isVisible().catch(() => false)) {
        console.log('  [Checkbox] Ticking Race: Asian');
        await asianCb.check({ force: true }).catch(() => {});
      }

      // Consent / Understand / Certify / Declaration Checkboxes
      const allCheckboxes = await page.$$('input[type="checkbox"]:not(:checked)');
      for (const cb of allCheckboxes) {
        if (await cb.isVisible().catch(() => false)) {
          console.log('  [Checkbox] Ticking consent/acknowledgement checkbox');
          await cb.check({ force: true }).catch(async () => {
            await cb.click({ force: true }).catch(() => {});
          });
        }
      }

      // Checkbox text clicks (e.g. "I consent to the processing", "I understand that the")
      const consentText = page.getByText(/I consent to the processing|I understand that the/i);
      if (await consentText.isVisible().catch(() => false)) {
        await consentText.click().catch(() => {});
      }
    } catch (e) {}

    // E. Resume Upload
    try {
      const fileInputs = await page.$$('input[type="file"]');
      if (fileInputs.length > 0 && config.resumePath && fs.existsSync(config.resumePath)) {
        for (const input of fileInputs) {
          const parentText = await input.evaluate(el => el.closest('section, div')?.innerText || '').catch(() => '');
          if (!parentText.includes('.pdf') && !parentText.includes('.docx')) {
            console.log(`📄 Uploading resume from: ${config.resumePath}`);
            await input.setInputFiles(config.resumePath).catch(() => {});
            await page.waitForTimeout(2000);
          }
        }
      }
    } catch (e) {}

    // F. Navigation: Next vs Final Apply / Submit Button
    await page.waitForTimeout(1000);

    const applySubmitBtn = page.getByRole('button', { name: /^Apply$|^Submit|^Submit application$/i });
    const nextBtn = page.getByRole('button', { name: /^Next$|^Save and continue$|^Continue$/i });

    if (await applySubmitBtn.isVisible().catch(() => false)) {
      console.log('🚀 Clicking final "Apply" / "Submit" button...');
      await applySubmitBtn.first().click();
      await page.waitForTimeout(5000);

      const textAfter = await page.innerText('body').catch(() => '');
      if (
        textAfter.toLowerCase().includes('submitted') || 
        textAfter.toLowerCase().includes('thank') ||
        textAfter.toLowerCase().includes('application received')
      ) {
        console.log('✅ Application successfully submitted!');
        return true;
      }
    } else if (await nextBtn.isVisible().catch(() => false)) {
      console.log('➡️ Clicking "Next" button...');
      await nextBtn.first().click();
      await page.waitForTimeout(3000);
    } else {
      console.log('ℹ️ Checking if submission is completed...');
      if (pageText.toLowerCase().includes('submitted') || pageText.toLowerCase().includes('thank')) {
        return true;
      }
      break;
    }
  }

  return false;
}

function getBraveExecutablePath() {
  const possiblePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(process.env.PROGRAMFILES || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
  ];
  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

// Main Runner Function
async function run() {
  console.log('====================================================');
  console.log('🚀 Starting Google Careers Auto-Apply Automation Script');
  console.log(`📍 Target URL: ${targetUrl}`);
  const userDataDir = path.join(__dirname, 'google_user_data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const launchOptions = {
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };

  const bravePath = getBraveExecutablePath();
  let context;

  if (bravePath) {
    console.log(`🌐 Launching System Default Browser (Brave: ${bravePath}) with anti-detection flags...`);
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        executablePath: bravePath
      });
      console.log('✅ Connected to system Brave browser (Stealth mode active).');
    } catch (err) {
      console.warn('⚠️ Could not launch Brave directly, falling back:', err.message);
    }
  }

  if (!context) {
    console.log('🌐 Launching System Browser (Google Chrome / Chromium) with anti-detection flags...');
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        channel: 'chrome'
      });
      console.log('✅ Connected to system Chrome browser (Stealth mode active).');
    } catch (err) {
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    }
  }

  // Stealth script to mask Playwright/Chromium automation signals
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    };
    if (window.navigator.permissions) {
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters && parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    }
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    console.log('🌐 Navigating to Google Careers page...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    // Check if sign-in is required
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      console.log('🔐 Google Sign-In required!');
      console.log('Please log into your Google Account in the browser window.');
      console.log('Waiting up to 5 minutes for authentication...');

      await page.waitForFunction(() => {
        return window.location.href.includes('google.com/about/careers') || window.location.href.includes('/jobs/');
      }, {}, { timeout: 300000 });

      console.log('✅ Authentication detected! Continuing to job application workflow...');
      await page.waitForTimeout(3000);
    }

    // Extract Job Listings / Apply Buttons from the page using multi-strategy scanner
    console.log('🔍 Scanning page for job listings and Apply buttons...');
    
    // Scroll down to load all items on page
    await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {});
    await page.waitForTimeout(2000);

    const jobs = await page.evaluate(() => {
      const results = [];
      const seenIds = new Set();

      // Strategy 1: Find links matching /results/ or /jobs/
      const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/results/"], a[href*="/results/"], a[href*="jobs/"]'));
      for (const a of anchors) {
        const href = a.href;
        if (href.includes('support.google.com') || href.includes('policies.google.com') || href.includes('privacy') || href.includes('terms') || href.includes('/help')) continue;
        
        const match = href.match(/\/jobs\/results\/([0-9A-Za-z_-]+)/) || href.match(/\/results\/([0-9A-Za-z_-]+)/);
        const id = match ? match[1] : (href.match(/id=([0-9A-Za-z_-]+)/) || [null, null])[1];
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          const card = a.closest('li, article, div[role="listitem"], .gc-card, tr, div');
          const title = a.innerText.trim() || (card ? card.querySelector('h2, h3, h4, span')?.innerText.trim() : '') || 'Google Role';
          results.push({ jobId: id, title: title, url: href, index: results.length });
        }
      }

      // Strategy 2: Scan cards containing Apply buttons or links
      if (results.length === 0) {
        const cards = Array.from(document.querySelectorAll('li, div[role="listitem"], article, .gc-card, .sjt2id, .LlV4wb, div.sc-'));
        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const applyLink = card.querySelector('a[href*="/apply"], a[href*="/results/"], button, a');
          const titleEl = card.querySelector('h2, h3, h4, a, span');
          if (applyLink && titleEl && titleEl.innerText.trim().length > 3) {
            const href = applyLink.href || '';
            if (href.includes('support.google.com') || href.includes('policies.google.com') || href.includes('privacy') || href.includes('help')) continue;
            const title = titleEl.innerText.trim();
            const id = 'google_job_' + i + '_' + Date.now();
            if (!seenIds.has(id)) {
              seenIds.add(id);
              results.push({ jobId: id, title: title, cardIndex: i, url: applyLink.getAttribute('href') ? applyLink.href : null, index: results.length });
            }
          }
        }
      }

      // Strategy 3: Find all Apply buttons on the page directly
      if (results.length === 0) {
        const applyBtns = Array.from(document.querySelectorAll('a[href*="/apply"], button[aria-label*="Apply"], a[aria-label*="Apply"], button, a')).filter(el => {
          const text = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('apply');
        });

        for (let i = 0; i < applyBtns.length; i++) {
          const btn = applyBtns[i];
          const parent = btn.closest('li, div[role="listitem"], article, div');
          const titleText = parent ? (parent.querySelector('h2, h3, h4, span')?.innerText.trim() || `Google Job #${i+1}`) : `Google Job #${i+1}`;
          const id = 'google_apply_' + i;
          results.push({ jobId: id, title: titleText, btnIndex: i, url: btn.getAttribute('href') ? btn.href : null, index: results.length });
        }
      }

      return results;
    });

    console.log(`📋 Found ${jobs.length} job item(s) on the page.`);

    let processedCount = 0;
    const maxApplications = config.maxApplications || 25;

    if (jobs.length > 0) {
      for (const job of jobs) {
        if (processedCount >= maxApplications) {
          console.log(`🛑 Reached maximum applications limit (${maxApplications}). Stopping.`);
          break;
        }

        console.log(`\n----------------------------------------------------`);
        console.log(`🎯 [Job ${processedCount + 1}/${jobs.length}] ID: ${job.jobId} | Title: "${job.title}"`);

        if (appliedJobs.some(j => j.jobId === job.jobId)) {
          console.log(`⏩ Job ID ${job.jobId} already exists in applied_jobs.json. Skipping.`);
          continue;
        }

        try {
          // Navigate to job detail or click apply button
          if (job.url && job.url.startsWith('http')) {
            console.log(`🔗 Navigating to job page: ${job.url}`);
            await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);

            const applyBtn = page.locator('a[href*="/apply"], button:has-text("Apply"), a:has-text("Apply"), [aria-label*="Apply"]').first();
            if (await applyBtn.isVisible().catch(() => false)) {
              console.log('👉 Clicking "Apply" button...');
              await applyBtn.click();
              await page.waitForTimeout(3000);
            }
          } else {
            console.log(`👉 Clicking Apply button #${job.index + 1} on main list page...`);
            const applyBtns = page.locator('a[href*="/apply"], button:has-text("Apply"), a:has-text("Apply"), [aria-label*="Apply"]');
            if (await applyBtns.count() > job.index) {
              await applyBtns.nth(job.index).click();
              await page.waitForTimeout(3000);
            }
          }

          // Fill application form & tick checkboxes using recorded selectors
          const success = await handleGoogleForm(page);

          if (success) {
            saveAppliedJob(job.jobId, job.title, 'Google', 95, [], [], `Applied on Google Careers`);
            const timestamp = Date.now();
            const screenshotPath = path.join(__dirname, `screenshot_success_${timestamp}.png`);
            await page.screenshot({ path: screenshotPath }).catch(() => {});
            console.log(`📸 Saved success screenshot to: ${screenshotPath}`);
            processedCount++;
          } else {
            console.warn(`⚠️ Application flow completed or required manual review for Job ID: ${job.jobId}`);
          }
        } catch (err) {
          console.error(`❌ Error applying for Job ID ${job.jobId}:`, err.message);
          const timestamp = Date.now();
          const errorScreenshot = path.join(__dirname, `screenshot_error_${timestamp}.png`);
          await page.screenshot({ path: errorScreenshot }).catch(() => {});
          console.log(`📸 Saved error screenshot to: ${errorScreenshot}`);
        }

        // Return to main jobs list URL for next job application
        console.log('🔄 Returning to saved jobs list for next application...');
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    } else {
      console.log('⚠️ Could not find explicit job list items. Attempting direct Apply button click on current page...');
      const applyBtn = page.locator('a[href*="/apply"], button:has-text("Apply"), a:has-text("Apply")').first();
      if (await applyBtn.isVisible().catch(() => false)) {
        console.log('👉 Clicking primary "Apply" button on page...');
        await applyBtn.click();
        await page.waitForTimeout(3000);
        await handleGoogleForm(page);
      }
    }

    console.log('\n====================================================');
    console.log(`🎉 Finished processing Google Careers applications! Total applied in this run: ${processedCount}`);
    console.log('====================================================');

  } catch (error) {
    console.error('❌ Fatal error in Google Careers script:', error);
  } finally {
    await context.close();
    console.log('🔒 Browser closed cleanly.');
  }
}

run().catch(err => {
  console.error('❌ Execution failed:', err);
});
