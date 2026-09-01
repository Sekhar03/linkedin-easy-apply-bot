const { chromium } = require('playwright');
const fs = require('fs');
const { calculateMatchScore } = require('./aiScore');
const { getSmartAnswer } = require('./geminiHelper');
const { generateHtmlReport } = require('./generateReport');
const { buildCustomResume } = require('./latexResumeBuilder');

// 1. Read configuration (matching apply.js)
let config = {};
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  console.log('Loaded config.json successfully.');
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
  await input.fill(answer);
}

// 2. Track Applied Jobs to avoid duplicates
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

// 3. Smart Form Logic (Adapted for Naukri)
// Naukri usually has either a chatbot flow or simple missing field forms
async function handleNaukriQuestions(page) {
  console.log('Checking for any extra form fields or questionnaires using Gemini AI...');

  // Attempt Resume Upload
  try {
    const uploadResume = page.getByText('Upload Resume');
    if (await uploadResume.isVisible({ timeout: 2000 })) {
      if (config.resumePath && fs.existsSync(config.resumePath)) {
        console.log(`Uploading resume from: ${config.resumePath}`);
        await uploadResume.click();
        await page.locator('input[type="file"]').setInputFiles(config.resumePath);
        await page.waitForTimeout(1000);
      }
    }
  } catch (e) {}

  // Function to extract question text near the input
  async function getQuestionText(page, element) {
      let text = '';
      const id = await element.getAttribute('id');
      if (id) {
          const label = await page.$(`label[for="${id}"]`);
          if (label) text = await label.innerText();
      }
      if (!text) {
          text = await element.evaluate((el) => {
              let parent = el.parentElement;
              let attempts = 0;
              while (parent && attempts < 5) {
                  const labelEl = parent.querySelector('label, .question-text, p');
                  if (labelEl && labelEl !== el && labelEl.innerText.trim().length > 3) {
                      return labelEl.innerText.trim();
                  }
                  parent = parent.parentElement;
                  attempts++;
              }
              
              // Chatbot Fallback
              const chatMessages = Array.from(document.querySelectorAll('.bot-msg, .msg-bubble, p, span, div.msg-content'))
                  .map(e => e.innerText ? e.innerText.trim() : '')
                  .filter(t => t.length > 15 && t.includes('?'));
              
              if (chatMessages.length > 0) return chatMessages[chatMessages.length - 1];
              
              const allTexts = Array.from(document.querySelectorAll('span, div, p'))
                  .map(e => e.innerText ? e.innerText.trim() : '')
                  .filter(t => t.length > 10 && !t.match(/^(yes|no|submit|save|apply)$/i));
              return allTexts.length > 0 ? allTexts[allTexts.length - 1] : '';
          });
      }
      return text || '';
  }

  // Fill visible text inputs
  const textInputs = await page.$$('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="file"]):not([type="submit"]), textarea, [contenteditable="true"]');
  for (const input of textInputs) {
    if (await input.isVisible()) {
      let val = '';
      try {
          val = await input.inputValue();
      } catch (e) {
          try { val = await input.innerText(); } catch (e2) {}
      }
      
      if (!val || val.trim() === '') {
         const questionText = await getQuestionText(page, input);
         let placeholder = '';
         try { placeholder = await input.getAttribute('placeholder') || ''; } catch (e) {}
         
         const combinedText = (questionText + ' ' + placeholder);
         
         if (combinedText.match(/keyword|designation|companies|location|job type|search/i) && combinedText.length < 50) {
             continue; // Skip Naukri's global search bars at the top of the page
         }
         
         const answer = await getSmartAnswer({
             questionText: combinedText,
             inputType: 'text'
         });
         console.log(`Q: "${questionText || placeholder || 'Unknown'}" -> Auto-filling with: "${answer}"`);
         
         try {
             await fillFieldHumanized(input, answer);
             
             // Auto-select dropdown if typing a location
             if (combinedText.match(/location|city/i)) {
                 await page.waitForTimeout(1500);
                 try {
                     const options = await page.$$('li, [role="option"], .suggestor-wrapper ul li, div[class*="dropdown"] li');
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
             
             await page.keyboard.press('Enter');
         } catch(err) {
             console.log("Failed to fill input:", err.message);
         }
      }
    }
  }

  // Handle Radio Buttons (Yes/No questionnaires)
  const radios = await page.$$('input[type="radio"]');
  const radioGroups = {};
  for (const radio of radios) {
      const name = await radio.getAttribute('name');
      const groupKey = name || await radio.evaluate(el => el.parentElement.parentElement.id || 'unnamed_group');
      if (!radioGroups[groupKey]) radioGroups[groupKey] = [];
      radioGroups[groupKey].push(radio);
  }

  for (const groupName of Object.keys(radioGroups)) {
      const group = radioGroups[groupName];
      let anyChecked = false;
      for (const r of group) {
          if (await r.isChecked()) anyChecked = true;
      }
      if (anyChecked) continue; // Skip if already answered

      const questionText = await getQuestionText(page, group[0]);
      
      const optionLabels = [];
      const radioElements = [];
      for (const r of group) {
          const id = await r.getAttribute('id');
          let labelText = '';
          if (id) {
              const labelEl = await page.$(`label[for="${id}"]`);
              if (labelEl) labelText = await labelEl.innerText();
          }
          if (!labelText) {
              labelText = await r.evaluate(el => el.nextElementSibling ? el.nextElementSibling.innerText : (el.parentElement ? el.parentElement.innerText : ''));
          }
          labelText = labelText.trim();
          if (labelText) {
              optionLabels.push(labelText);
              radioElements.push({ radio: r, labelText });
          }
      }

      const targetAnswer = await getSmartAnswer({
          questionText,
          inputType: 'radio',
          options: optionLabels
      });
      
      console.log(`Q (Radio): "${questionText || 'Unknown'}" -> Auto-selecting: "${targetAnswer}"`);

      let clicked = false;
      const targetObj = radioElements.find(re => re.labelText.toLowerCase() === targetAnswer.toLowerCase() || re.labelText.toLowerCase().includes(targetAnswer.toLowerCase()) || targetAnswer.toLowerCase().includes(re.labelText.toLowerCase()));
      if (targetObj) {
          await targetObj.radio.evaluate(el => {
              if (el.parentElement && el.parentElement.tagName !== 'BODY') {
                  el.parentElement.click();
              } else {
                  el.click();
              }
          });
          clicked = true;
      }
      
      if (!clicked && group.length > 0) {
          await group[0].evaluate(el => {
              if (el.parentElement && el.parentElement.tagName !== 'BODY') el.parentElement.click();
              else el.click();
          });
      }
  }

  // Handle Custom UI Options (Elements acting as Radio Buttons without <input type="radio">)
  try {
      const yesOptions = await page.locator('text=/^yes$/i').all();
      const noOptions = await page.locator('text=/^no$/i').all();
      
      if (yesOptions.length > 0 || noOptions.length > 0) {
          let lastQuestion = "Unknown chatbot question";
          const texts = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('.bot-msg, .question-text, p, span, label'))
                  .map(el => el.innerText.trim())
                  .filter(text => text.length > 10 && !text.match(/^yes$|^no$/i));
          });
          if (texts.length > 0) lastQuestion = texts[texts.length - 1];

          const targetAnswer = await getSmartAnswer({
              questionText: lastQuestion,
              inputType: 'radio',
              options: ['Yes', 'No']
          });
          console.log(`Q (Custom UI Radio): "${lastQuestion}" -> Auto-selecting: "${targetAnswer}"`);

          if (targetAnswer.toLowerCase() === 'yes' && yesOptions.length > 0) {
              await yesOptions[yesOptions.length - 1].evaluate(el => el.click());
          } else if (targetAnswer.toLowerCase() === 'no' && noOptions.length > 0) {
              await noOptions[noOptions.length - 1].evaluate(el => el.click());
          } else if (yesOptions.length > 0) {
              await yesOptions[yesOptions.length - 1].evaluate(el => el.click());
          }
          await page.waitForTimeout(1000);
      }
  } catch (e) {}
  
  // Look for any Submit/Save buttons that might appear after filling details
  try {
      const rect = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('button, div, span, a')).filter(el => {
              const text = el.innerText ? el.innerText.trim().toLowerCase() : '';
              if (!(text === 'save' || text === 'submit' || text === 'save & apply')) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
          });
          if (els.length === 0) return null;
          
          els.sort((a, b) => {
              const getZ = (el) => {
                  let z = 0, curr = el;
                  while (curr && curr !== document.body) {
                      const style = window.getComputedStyle(curr);
                      if (style.zIndex && style.zIndex !== 'auto') z = Math.max(z, parseInt(style.zIndex, 10) || 0);
                      curr = curr.parentElement;
                  }
                  return z;
              };
              return getZ(b) - getZ(a);
          });
          
          const box = els[0].getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      
      if (rect) {
          console.log(`Clicking Save/Submit via hardware mouse at (${Math.round(rect.x)}, ${Math.round(rect.y)})...`);
          await page.mouse.click(rect.x, rect.y);
          await page.waitForTimeout(2000);
      }
  } catch (e) {
      console.log("Error clicking save:", e.message);
  }
}

(async () => {
  // Launch Playwright with Persistent Context
  // This helps save your login session so you don't have to enter OTP every time
  const userDataDir = './naukri_user_data';
  console.log(`Starting Chromium browser (Data Dir: ${userDataDir})...`);
  
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

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    userAgent: selectedUA,
    args: ['--start-maximized']
  });

  const page = browser.pages().length > 0 ? browser.pages()[0] : await browser.newPage();
  
  console.log('Navigating to Naukri...');
  await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded' });

  // 4. Login Logic
  // Check if we are already logged in (Profile icon or Opportunities link exists)
  const isLoggedIn = await page.locator('.nI-gNb-drawer__icon-img, .nI-gNb-dp-icon, a:has-text("Opportunities")').isVisible({ timeout: 5000 }).catch(() => false);

  if (!isLoggedIn) {
      console.log("Not logged in. Proceeding to Login flow...");
      try {
          await page.getByRole('link', { name: 'Login', exact: true }).click();
          await page.getByRole('button', { name: 'Use OTP to Login' }).click();
          
          const mobile = config.mobileNumber || '8260960591'; // Fallback if missing in config
          await page.getByRole('textbox', { name: 'Enter your 10 digit mobile' }).fill(mobile);
          await page.getByRole('button', { name: 'Get OTP' }).click();
          
          if (process.send) {
              process.send({
                  type: 'intervention-required',
                  questionText: 'Naukri Login OTP: Please check the browser window, enter the OTP sent to your mobile, and click Login. Once done, click Resume in the dashboard.',
                  inputType: 'manual-action',
                  options: []
              });
              console.log("⏳ Waiting for user to complete OTP login via Web dashboard...");
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
              console.log("\n===========================================");
              console.log("⏳ WAITING FOR MANUAL OTP ENTRY");
              console.log("Please enter the OTP in the browser window and click Login.");
              console.log("The script will resume automatically once logged in.");
              console.log("===========================================\n");
              
              // Wait indefinitely until login succeeds
              await page.waitForSelector('.nI-gNb-drawer__icon-img, .nI-gNb-dp-icon, a:has-text("Opportunities")', { timeout: 0 });
          }
          console.log("✅ LOGIN SUCCESSFUL!");
      } catch (err) {
          console.log("Could not follow automated login path. Please login manually in the browser.");
          await page.waitForSelector('.nI-gNb-drawer__icon-img, .nI-gNb-dp-icon, a:has-text("Opportunities")', { timeout: 0 });
      }
  } else {
      console.log("✅ ALREADY LOGGED IN!");
  }

  // 5. Job Application Loop
  // You can customize the URL to your specific search parameters or recommended jobs
  const naukriUrl = config.naukriTargetUrl || 'https://www.naukri.com/product-engineer-jobs?k=product%20engineer%2C%20product%20manager%2C%20product%20analyst%2C%20product%20owner';
  console.log(`Navigating to search results URL: ${naukriUrl}`);
  await page.goto(naukriUrl, { waitUntil: 'domcontentloaded' });
  
  await page.waitForLoadState('domcontentloaded');
  console.log("Loading job list...");

  let applyCount = 0;
  const maxApplications = config.maxApplications || 25;

  while (applyCount < maxApplications) {
      // Make selectors robust to handle different Naukri layouts (classic and campus)
      const jobSelector = '.srp-jobtuple-wrapper, .jobTuple, .cust-job-tuple, a.title, [class*="jobTuple"], div:has(> div label input[type="checkbox"])';
      try {
          await page.waitForSelector(jobSelector, { timeout: 15000 });
      } catch (e) {
          console.log("Could not find standard job selectors, trying fallbacks...");
      }
      
      let jobLinks = await page.$$(jobSelector);
      if (jobLinks.length === 0) {
          jobLinks = await page.$$('a[href*="/job-listings-"], a[href*="/jobs/"]');
      }
      
      const priorityKeywords = config.priorityKeywords || ["product"];
      const blacklistKeywords = config.blacklistKeywords || [];

      const priorityIndices = [];
      const otherIndices = [];
      for (let i = 0; i < jobLinks.length; i++) {
          try {
              const fullCardText = await jobLinks[i].innerText();
              const titleText = fullCardText.split('\n')[0] || `Job ${i}`;
              
              // Blacklist filter
              const isBlacklisted = blacklistKeywords.some(kw => new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(titleText));
              if (isBlacklisted) {
                  console.log(`Skipping Blacklisted Role on Naukri: "${titleText.trim()}"`);
                  continue;
              }
              
              const isPriority = priorityKeywords.some(kw => new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(titleText));
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
      console.log(`Prioritizing ${priorityIndices.length} priority jobs out of ${jobLinks.length} total on this page.`);

      for (let idx = 0; idx < sortedIndices.length; idx++) {
          const i = sortedIndices[idx];
          if (applyCount >= maxApplications) break;

          const jobLinkElement = jobLinks[i];
          const fullCardText = await jobLinkElement.innerText();
          const titleText = fullCardText.split('\n')[0] || `Job ${i}`;
          
          // Fast-skip if the website already marks it as Applied on the card
          if (fullCardText.match(/\b(Applied|Already Applied)\b/i)) {
              console.log(`\n➤ Skipping Job: ${titleText} (Website shows it is already Applied)`);
              continue;
          }
          
          console.log(`\n➤ Opening Job: ${titleText}`);

          // Click the job title/card natively to let Naukri open the new tab
          const newPagePromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
          
          const titleLink = await jobLinkElement.$('a.title, [class*="title"], h2');
          if (titleLink) {
              await titleLink.click();
          } else {
              const box = await jobLinkElement.boundingBox();
              if (box) await page.mouse.click(box.x + box.width / 2, box.y + 20);
              else await jobLinkElement.click();
          }
          
          const jobPage = await newPagePromise;
          if (!jobPage) {
              console.log("⏭️ Could not detect new tab opening. Skipping...");
              continue;
          }
          
          await jobPage.waitForLoadState('domcontentloaded');
          
          // The user suggested getting the Job ID directly from the newly opened tab's URL!
          const jobUrl = jobPage.url();
          const match = jobUrl.match(/-(\d+)\?/) || jobUrl.match(/-(\d+)$/);
          const jobId = match ? match[1] : (jobUrl.split('?')[0].split('-').pop() || `unknown-${Date.now()}`);
          
          console.log(`Extracted Job ID from URL: ${jobId}`);

          // Skip if already applied according to JSON database
          if (appliedJobs.some(j => j.jobId === jobId)) {
              console.log(`⏭️ Already tracked ID ${jobId} in database, closing tab and skipping...`);
              await jobPage.close();
              continue;
          }

          try {
              // Extract Match Score
              let matchScore = null;
              let matchingSkills = [];
              let missingSkills = [];
              let matchDescription = '';
              try {
                  const descLoc = jobPage.locator('.job-desc, .styles_JDC__dang-inner-html, .jdContainer, .job-description, .dang-inner-html').first();
                  if (await descLoc.count() > 0) {
                      const descText = await descLoc.innerText();
                      console.log('Calculating Match Probability using Gemini AI...');
                      const matchResult = await calculateMatchScore(descText, titleText);
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
                  saveAppliedJob(jobId, titleText, 'Skipped (Low Match Score)', matchScore, matchingSkills, missingSkills, `Skipped: Match score too low - ${matchDescription}`);
                  await jobPage.close();
                  continue;
              }

              if (config.jitResumeCustomization) {
                  try {
                      const descLoc = jobPage.locator('.job-desc, .styles_JDC__dang-inner-html, .jdContainer, .job-description, .dang-inner-html').first();
                      if (await descLoc.count() > 0) {
                          const descText = await descLoc.innerText();
                          console.log(`🛠️ Tailoring resume for "${titleText.trim()}" at Naukri...`);
                          await buildCustomResume(titleText, 'Naukri (Scraped)', descText);
                      }
                  } catch (err) {
                      console.warn(`Failed to dynamically tailor resume: ${err.message}. Using default.`);
                  }
              }

              // Use a broader selector for the Apply button (Naukri uses variations like "Apply", "Apply Now", id="apply-button", etc.)
              const applyButton = jobPage.locator('button:has-text("Apply"), #apply-button, .apply-button').first();
              
              // Wait up to 10 seconds for the button to appear in the DOM
              await applyButton.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
              
              if (await applyButton.isVisible({ timeout: 5000 })) {
                  console.log('Clicking Apply...');
                  await applyButton.click();
                  
                  // Wait to see if any form, chatbot, or immediate success appears
                  await jobPage.waitForTimeout(2000);
                  
                  // Chatbot questionnaires often ask one question at a time.
                  // We loop up to 5 times to answer sequential questions.
                  let attempt = 0;
                  const successMsg = jobPage.locator('.apply-message, :text-matches("successfully applied", "i"), :text-matches("Application Sent", "i")').first();
                  
                  while (attempt < 5) {
                      await handleNaukriQuestions(jobPage);
                      
                      // Check if success message appeared early
                      if (await successMsg.isVisible({ timeout: 2000 }).catch(()=>false)) {
                          break;
                      }
                      
                      // Check if a Save/Submit button is still present inside a modal.
                      const hasModalSaveBtn = await jobPage.evaluate(() => {
                          return Array.from(document.querySelectorAll('button, div, span, a')).some(el => {
                              const text = el.innerText ? el.innerText.trim().toLowerCase() : '';
                              if (!(text === 'save' || text === 'submit' || text === 'save & apply')) return false;
                              const rect = el.getBoundingClientRect();
                              if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).visibility === 'hidden') return false;
                              
                              let curr = el;
                              while (curr && curr !== document.body) {
                                  const z = window.getComputedStyle(curr).zIndex;
                                  if (z !== 'auto' && parseInt(z, 10) > 10) return true;
                                  curr = curr.parentElement;
                              }
                              return false;
                          });
                      });
                      
                      if (!hasModalSaveBtn) {
                          break; // No more questions/modal save buttons found
                      }
                      attempt++;
                  }

                  // Final Validate Success
                  await successMsg.waitFor({ state: 'visible', timeout: 15000 });
                  
                  console.log(`✅ Successfully applied!`);
                  saveAppliedJob(jobId, titleText, 'Naukri (Scraped)', matchScore, matchingSkills, missingSkills, matchDescription);
                  applyCount++;
              } else {
                  // Sometimes the apply button says "Applied" or redirects to external site (Company Website)
                  console.log(`⏭️ Skipped (Apply button not found, may be already applied or external site).`);
                  saveAppliedJob(jobId, titleText, 'Skipped/External', matchScore, matchingSkills, missingSkills, matchDescription); // save so we don't visit it again
              }
          } catch (e) {
              console.log(`❌ Failed: ${e.message}`);
          } finally {
              // Close the job tab and continue
              await jobPage.close();
              await page.waitForTimeout(2000); // polite delay
          }
      }

      if (applyCount >= maxApplications) {
          console.log(`\n🎉 Reached config maxApplications limit (${maxApplications}). Stopping.`);
          break;
      }

      // Pagination - Go to next page if it exists
      const nextBtn = await page.$('a.fright:has-text("Next"), span:has-text("Next")');
      if (nextBtn) {
          console.log('Navigating to next page...');
          await nextBtn.click();
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(3000);
      } else {
          console.log('No more pages found.');
          break;
      }
  }

  console.log("\nScript completed successfully. Closing browser...");
  generateHtmlReport();
  await browser.close();
})();
