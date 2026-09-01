const { chromium } = require('playwright');
const fs = require('fs');
const { sendNotification } = require('./notify');

// Read config
let config = {};
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (err) {
  console.error('Error reading config.json:', err.message);
  process.exit(1);
}

let appliedCount = 0;
const jobQueue = [];
let managerDone = false;
let maxApplications = config.maxApplications || 25;

// Verify state.json exists (Optional)
const hasState = fs.existsSync('state.json');
if (!hasState) {
  console.log('Note: state.json not found. Launching a clean browser session. You may need to sign in directly in the browser window.');
}

const APPLIED_JOBS_FILE = 'applied_jobs.json';
let appliedJobs = [];
try {
  if (fs.existsSync(APPLIED_JOBS_FILE)) {
    appliedJobs = JSON.parse(fs.readFileSync(APPLIED_JOBS_FILE, 'utf8'));
  }
} catch (err) {
  console.warn('Error reading applied_jobs.json, starting clean:', err.message);
}

function saveAppliedJob(jobId, title, company) {
  if (!jobId) return;
  if (!appliedJobs.some(j => j.jobId === jobId)) {
    appliedJobs.push({
      jobId,
      title: title.trim(),
      company: company.trim(),
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
  
  // CTC / Salary questions
  if (q.includes('current') && (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package'))) {
    return config.defaultAnswers['current ctc'] || '450000';
  }
  if ((q.includes('expected') || q.includes('expect')) && (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package'))) {
    return config.defaultAnswers['expected ctc'] || '1200000';
  }
  if (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package')) {
    return config.defaultAnswers['expected ctc'] || '1200000';
  }
  
  // Notice period questions
  if (q.includes('notice')) {
    return config.defaultAnswers['notice period'] || '30';
  }
  
  // Academic / Education details
  if (q.includes('cgpa') || q.includes('gpa') || q.includes('percentage') || q.includes('marks') || q.includes('score')) {
    return config.defaultAnswers['cgpa'] || '7.54';
  }
  if (q.includes('college') || q.includes('university') || q.includes('school') || q.includes('institute')) {
    return 'IGIT Sarang';
  }
  if (q.includes('degree') || q.includes('major') || q.includes('discipline') || q.includes('stream')) {
    return 'Electronics and Telecommunication Engineering';
  }
  
  // Location
  if (q.includes('location') || q.includes('city') || q.includes('live') || q.includes('reside') || q.includes('address')) {
    return 'Paradeep, Odisha';
  }
  
  // Experience / Numbers
  const isNumeric = inputType === 'number' || q.includes('years') || q.includes('experience') || q.includes('how many');
  if (isNumeric) {
    return '2'; // fallback based on resume
  }
  
  // Generic text fallbacks
  if (q.includes('why') || q.includes('describe') || q.includes('tell me')) {
    return 'Experienced Product Engineer with strong background in building FinTech and payment systems.';
  }
  
  if (q.includes('phone') || q.includes('mobile') || q.includes('contact number')) {
    return config.defaultAnswers['phone'] || '8260960591';
  }
  
  return 'Yes'; // standard confirmation fallback
}

async function correctInvalidFields(page) {
  console.log('Attempting auto-correction of invalid fields...');
  
  // Find all form elements that have an error wrapper
  const errorElements = await page.$$('.artdeco-inline-feedback--error, [id*="error"]');
  if (errorElements.length === 0) return false;
  
  let correctedAny = false;
  
  for (const err of errorElements) {
    const errorText = await err.innerText().catch(() => '');
    if (!errorText) continue;
    
    console.log(`- Found validation warning: "${errorText.trim()}"`);
    
    // Find the closest form container to locate the corresponding input/select
    const container = await err.evaluateHandle(el => {
      return el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, div.fb-form-element');
    });
    
    if (!container) continue;
    
    const containerEl = container.asElement();
    if (!containerEl) continue;
    
    // Check if there is a text input / number input in this container
    const input = await containerEl.$('input[type="text"], input[type="number"], input:not([type]), textarea');
    if (input && await input.isVisible()) {
      const questionText = await getQuestionText(page, input);
      console.log(`  Target Input Question: "${questionText}"`);
      
      const errLower = errorText.toLowerCase();
      let refillValue = null;
      
      if (errLower.includes('number') || errLower.includes('digits') || errLower.includes('numeric') || errLower.includes('integer') || errLower.includes('valid value') || errLower.includes('enter a value') || errLower.includes('format')) {
        // Look at question text to guess a number
        if (questionText.toLowerCase().includes('notice') || questionText.toLowerCase().includes('period')) {
          refillValue = config.defaultAnswers['notice period'] || '30';
        } else if (questionText.toLowerCase().includes('ctc') || questionText.toLowerCase().includes('salary') || questionText.toLowerCase().includes('compensation')) {
          if (questionText.toLowerCase().includes('current')) {
            refillValue = config.defaultAnswers['current ctc'] || '450000';
          } else {
            refillValue = config.defaultAnswers['expected ctc'] || '1200000';
          }
        } else if (questionText.toLowerCase().includes('year') || questionText.toLowerCase().includes('experience')) {
          refillValue = '2'; // standard fallback
        } else {
          refillValue = '0'; // safe numeric fallback
        }
      } else {
        // General text fallback
        if (questionText.toLowerCase().includes('notice') || questionText.toLowerCase().includes('period')) {
          refillValue = config.defaultAnswers['notice period'] || '30';
        } else if (questionText.toLowerCase().includes('ctc') || questionText.toLowerCase().includes('salary') || questionText.toLowerCase().includes('compensation')) {
          if (questionText.toLowerCase().includes('current')) {
            refillValue = config.defaultAnswers['current ctc'] || '450000';
          } else {
            refillValue = config.defaultAnswers['expected ctc'] || '1200000';
          }
        } else {
          refillValue = 'Yes';
        }
      }
      
      if (refillValue) {
        console.log(`  Refilling text/number input with: "${refillValue}"`);
        await input.fill(refillValue);
        correctedAny = true;
      }
    }
    
    // Check if there is a select element in this container
    const select = await containerEl.$('select');
    if (select && await select.isVisible()) {
      const questionText = await getQuestionText(page, select);
      console.log(`  Target Select Question: "${questionText}"`);
      
      const options = await select.$eval('option', opts => opts.map(o => ({ value: o.value, text: o.text.trim() })));
      const nonPlaceholder = options.find(o => {
        const txt = o.text.toLowerCase();
        return o.value !== '' && !txt.includes('select') && !txt.includes('choose');
      });
      
      if (nonPlaceholder) {
        console.log(`  Selecting select option fallback: "${nonPlaceholder.text}"`);
        await select.click().catch(() => {});
        await select.selectOption(nonPlaceholder.value);
        await select.dispatchEvent('change');
        await select.dispatchEvent('input');
        correctedAny = true;
      }
    }
    
    // Check if there are radio buttons in this container
    const radios = await containerEl.$('input[type="radio"]');
    if (radios.length > 0) {
      let anyChecked = false;
      for (const rad of radios) {
        if (await rad.isChecked()) anyChecked = true;
      }
      
      if (!anyChecked) {
        const firstRadio = radios[0];
        const id = await firstRadio.getAttribute('id');
        let clicked = false;
        if (id) {
          const label = await page.$(`label[for="${id}"]`);
          if (label) {
            console.log(`  Checking fallback radio label: "${await label.innerText()}"`);
            await label.click().catch(() => {});
            clicked = true;
          }
        }
        if (!clicked) {
          console.log(`  Checking fallback radio directly.`);
          await firstRadio.click({ force: true }).catch(() => {});
        }
        correctedAny = true;
      }
    }
  }
  
  return correctedAny;
}

async function getQuestionText(page, element) {
  // Try to find label using 'for' attribute
  const id = await element.getAttribute('id');
  if (id) {
    const label = await page.$(`label[for="${id}"]`);
    if (label) {
      const text = await label.innerText();
      if (text) return text.trim();
    }
  }
  
  // Try to find closest ancestor question label
  const questionText = await element.evaluate((el) => {
    let parent = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, fieldset, div');
    while (parent) {
      const labelEl = parent.querySelector('.fb-dash-form-element__label, label, legend, .fb-form-element-label, h3');
      if (labelEl) {
        return labelEl.innerText.trim();
      }
      parent = parent.parentElement;
    }
    return '';
  });
  
  return questionText;
}

function matchOption(labelText, answer) {
  const label = labelText.trim().toLowerCase();
  const ans = answer.trim().toLowerCase();
  
  if (label === ans) return true;
  
  // Strict yes/no matching using word boundaries
  if (ans === 'yes') {
    return label === 'yes' || /^(yes|y)\b/.test(label) || label.includes('agree');
  }
  if (ans === 'no') {
    return label === 'no' || /^(no|n)\b/.test(label) || label.includes('disagree');
  }
  
  return label.includes(ans);
}

async function fillFieldsOnCurrentScreen(page) {
  console.log('Filling fields on current screen...');
  
  // 1. Handle standard Select Dropdowns
  const selectElements = await page.$$('[role="dialog"] select');
  for (const select of selectElements) {
    const isVisible = await select.isVisible();
    if (!isVisible) continue;
    
    const questionText = await getQuestionText(page, select);
    console.log(`- Found Dropdown. Question: "${questionText}"`);
    
    // Get all options
    const options = await select.$$eval('option', opts => opts.map(o => ({ value: o.value, text: o.text.trim() })));
    
    // Find best option matching config
    let selectedValue = null;
    let matchedKey = null;
    for (const key of Object.keys(config.defaultAnswers)) {
      if (questionText.toLowerCase().includes(key.toLowerCase())) {
        matchedKey = key;
        const answer = config.defaultAnswers[key];
        const bestOpt = options.find(o => o.text.toLowerCase().includes(answer.toLowerCase()));
        if (bestOpt) {
          selectedValue = bestOpt.value;
          break;
        }
      }
    }
    
    // If no match found, select the first non-placeholder option
    if (!selectedValue && options.length > 0) {
      const nonPlaceholder = options.find(o => {
        const txt = o.text.toLowerCase();
        return o.value !== '' && !txt.includes('select') && !txt.includes('choose');
      });
      selectedValue = nonPlaceholder ? nonPlaceholder.value : options[0].value;
    }
    
    if (selectedValue) {
      console.log(`  Selected option: "${selectedValue}" (matched key: ${matchedKey || 'none/fallback'})`);
      await select.click();
      await page.waitForTimeout(500);
      await select.selectOption(selectedValue);
      await select.dispatchEvent('change');
      await select.dispatchEvent('input');
    }
  }
  
  // 2. Handle Text Inputs / Textareas
  const textInputs = await page.$$('[role="dialog"] input[type="text"], [role="dialog"] input[type="number"], [role="dialog"] input:not([type]), [role="dialog"] textarea');
  for (const input of textInputs) {
    const isVisible = await input.isVisible();
    if (!isVisible) continue;
    
    // Skip if already has value
    const currentValue = await input.inputValue();
    if (currentValue && currentValue.trim() !== '') {
      console.log(`- Text input already filled: "${currentValue}"`);
      continue;
    }
    
    const questionText = await getQuestionText(page, input);
    console.log(`- Found Text Input. Question: "${questionText}"`);
    
    let answer = null;
    for (const key of Object.keys(config.defaultAnswers)) {
      if (questionText.toLowerCase().includes(key.toLowerCase())) {
        answer = config.defaultAnswers[key];
        break;
      }
    }
    
    // Defaults for empty inputs
    if (!answer) {
      const type = await input.getAttribute('type');
      answer = getSmartFallbackAnswer(questionText, type);
    }
    
    console.log(`  Filling with: "${answer}"`);
    await input.fill(answer);
  }
  
  // 3. Handle Radio Buttons (usually Yes/No questions)
  const radios = await page.$$('[role="dialog"] input[type="radio"]');
  const radioGroups = {};
  for (const radio of radios) {
    const name = await radio.getAttribute('name');
    if (name) {
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(radio);
    }
  }
  
  for (const name of Object.keys(radioGroups)) {
    const group = radioGroups[name];
    
    // Check if one is already checked
    let alreadyChecked = false;
    for (const radio of group) {
      if (await radio.isChecked()) {
        alreadyChecked = true;
        break;
      }
    }
    if (alreadyChecked) continue;
    
    const firstRadio = group[0];
    const questionText = await getQuestionText(page, firstRadio);
    console.log(`- Found Radio Group. Question: "${questionText}"`);
    
    let answer = 'yes'; // default fallback
    for (const key of Object.keys(config.defaultAnswers)) {
      if (questionText.toLowerCase().includes(key.toLowerCase())) {
        answer = config.defaultAnswers[key].toLowerCase();
        break;
      }
    }
    
    let clicked = false;
    for (const radio of group) {
      const id = await radio.getAttribute('id');
      let labelText = '';
      let labelEl = null;
      if (id) {
        labelEl = await page.$(`label[for="${id}"]`);
        if (labelEl) labelText = await labelEl.innerText();
      }
      if (!labelText) {
        const nextSibling = await radio.evaluateHandle(el => el.nextElementSibling);
        const isLabel = nextSibling ? await nextSibling.evaluate(el => el.tagName === 'LABEL') : false;
        if (isLabel) {
          labelEl = nextSibling;
          labelText = await labelEl.evaluate(el => el.innerText);
        }
      }
      if (!labelText) {
        labelText = await radio.evaluate(el => el.nextElementSibling ? el.nextElementSibling.innerText : '');
      }
      
      labelText = labelText.trim().toLowerCase();
      if (matchOption(labelText, answer)) {
        console.log(`  Checking radio option: "${labelText}"`);
        if (labelEl) {
          await labelEl.click().catch(async () => {
            await radio.click({ force: true }).catch(() => {});
          });
        } else {
          await radio.click({ force: true }).catch(() => {});
        }
        clicked = true;
        break;
      }
    }
    
    if (!clicked && group.length > 0) {
      console.log(`  No matching radio found. Checking first option by default.`);
      const id = await group[0].getAttribute('id');
      let clickedFallback = false;
      if (id) {
        const label = await page.$(`label[for="${id}"]`);
        if (label) {
          await label.click().catch(() => {});
          clickedFallback = true;
        }
      }
      if (!clickedFallback) {
        await group[0].click({ force: true }).catch(() => {});
      }
    }
  }
  
  // 4. Handle Checkboxes (agreements, etc.)
  const checkboxes = await page.$$('[role="dialog"] input[type="checkbox"]');
  for (const checkbox of checkboxes) {
    const isVisible = await checkbox.isVisible();
    if (!isVisible) continue;
    
    const isChecked = await checkbox.isChecked();
    if (!isChecked) {
      console.log('- Found Checkbox. Checking for agreement/consent.');
      const id = await checkbox.getAttribute('id');
      let checked = false;
      if (id) {
        const label = await page.$(`label[for="${id}"]`);
        if (label) {
          await label.click().catch(() => {});
          checked = true;
        }
      }
      if (!checked) {
        await checkbox.check({ force: true }).catch(() => {});
      }
    }
  }

  // 5. Handle Custom/Artdeco Dropdowns
  const customDropdowns = await page.$$('[role="dialog"] button[aria-haspopup="listbox"], [role="dialog"] .artdeco-dropdown__trigger');
  for (const trigger of customDropdowns) {
    const isVisible = await trigger.isVisible();
    if (!isVisible) continue;
    
    const triggerText = await trigger.innerText();
    if (triggerText && !triggerText.toLowerCase().includes('select') && !triggerText.toLowerCase().includes('choose')) {
      console.log(`- Custom Dropdown already selected: "${triggerText.trim()}"`);
      continue;
    }
    
    const questionText = await getQuestionText(page, trigger);
    console.log(`- Found Custom Dropdown. Question: "${questionText}"`);
    
    // Click to open dropdown
    await trigger.click();
    await page.waitForTimeout(1000);
    
    // Find options inside listbox
    const options = await page.$$('[role="option"], .artdeco-dropdown__item, [id*="select-options"] li');
    if (options.length > 0) {
      let optionTexts = [];
      for (const opt of options) {
        const txt = await opt.innerText();
        optionTexts.push({ element: opt, text: txt.trim() });
      }
      
      let selectedOpt = null;
      for (const key of Object.keys(config.defaultAnswers)) {
        if (questionText.toLowerCase().includes(key.toLowerCase())) {
          const answer = config.defaultAnswers[key];
          selectedOpt = optionTexts.find(o => o.text.toLowerCase().includes(answer.toLowerCase()));
          if (selectedOpt) break;
        }
      }
      
      if (!selectedOpt && optionTexts.length > 0) {
        selectedOpt = optionTexts.find(o => o.text !== '');
      }
      
      if (selectedOpt) {
        console.log(`  Selected custom option: "${selectedOpt.text}"`);
        await selectedOpt.element.click();
        await page.waitForTimeout(500);
      } else {
        await trigger.click(); // Close
      }
    } else {
      await trigger.click(); // Close
    }
  }

  // 6. Handle File Uploads (Resume)
  const fileInputs = await page.$$('[role="dialog"] input[type="file"], input[type="file"]');
  for (const fileInput of fileInputs) {
    try {
      const isVisible = await fileInput.isVisible();
      if (!isVisible) continue;
    } catch (e) { continue; }
    
    if (config.resumePath && fs.existsSync(config.resumePath)) {
      console.log(`- Found File Upload. Uploading resume from: ${config.resumePath}`);
      try {
        await fileInput.setInputFiles(config.resumePath);
        await page.waitForTimeout(1000);
      } catch (err) {
        console.warn(`  Failed to upload resume: ${err.message}`);
      }
    } else if (config.resumePath) {
      console.log(`- Found File Upload, but configured resume file not found: ${config.resumePath}`);
    } else {
      console.log(`- Found File Upload, but no resumePath is configured.`);
    }
  }
}

async function handleDiscardConfirmation(page) {
  const discardSelectors = [
    '[data-test-modal-id="data-test-easy-apply-discard-confirmation"] button',
    '.artdeco-modal-overlay--layer-confirmation button',
    '[data-test-is-confirm-dialog] button'
  ];
  
  for (const selector of discardSelectors) {
    const buttons = await page.$$(selector);
    for (const btn of buttons) {
      const text = await btn.innerText().catch(() => '');
      if (text.toLowerCase().includes('discard')) {
        console.log(`Found discard button with text "${text.trim()}". Clicking...`);
        await btn.click().catch(() => {});
        await page.waitForTimeout(1500);
        return true;
      }
    }
  }
  return false;
}

async function ensureNoModalsOpen(page) {
  // 1. Check for discard confirmation modal
  let discardModal = await page.$('[data-test-modal-id="data-test-easy-apply-discard-confirmation"], .artdeco-modal-overlay--layer-confirmation');
  if (discardModal) {
    console.log('Detected leftover discard confirmation modal. Closing it...');
    const closed = await handleDiscardConfirmation(page);
    if (!closed) {
      console.warn('Could not click discard button inside discard confirmation modal. Trying Escape...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }
  }

  // 2. Check for standard Easy Apply modal
  let modal = await page.$('[role="dialog"], .artdeco-modal');
  if (modal) {
    console.log('Detected leftover Easy Apply modal. Cancelling...');
    const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss, [role="dialog"] button:has-text("Cancel")');
    if (dismissBtn) {
      await dismissBtn.click();
      await page.waitForTimeout(1500);
      
      // Check if discard confirmation popped up
      let hasDiscardModal = await page.$('[data-test-modal-id="data-test-easy-apply-discard-confirmation"], .artdeco-modal-overlay--layer-confirmation');
      if (hasDiscardModal) {
        await handleDiscardConfirmation(page);
      }
    }
  }
}

async function cancelApplication(page) {
  console.log('Cancelling and discarding application...');
  await page.screenshot({ path: `screenshot_error_${Date.now()}.png` }).catch(() => {});
  const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss, [role="dialog"] button:has-text("Cancel")');
  if (dismissBtn) {
    await dismissBtn.click();
    await page.waitForTimeout(1500);
    
    const closed = await handleDiscardConfirmation(page);
    if (!closed) {
      console.warn('Could not click discard button. Trying Escape key...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }
  }
}

async function handleEasyApplyModal(page) {
  console.log('Handling Easy Apply Modal...');
  
  const maxSteps = 15; 
  let step = 0;
  
  while (step < maxSteps) {
    step++;
    console.log(`Processing modal screen step ${step}...`);
    
    const isModalVisible = await page.isVisible('[role="dialog"], .artdeco-modal');
    if (!isModalVisible) {
      console.log('Modal is no longer visible.');
      break;
    }
    
    await fillFieldsOnCurrentScreen(page);
    
    // Check for "Submit application" or "Submit" buttons
    const submitBtn = await page.$('button:has-text("Submit application"), button:has-text("Submit")');
    if (submitBtn) {
      console.log('Found Submit button! Submitting application...');
      
      // Wait for any loaders/overlays to disappear first
      try {
        await page.waitForSelector('.jobs-loader, .artdeco-loader, .spinner', { state: 'hidden', timeout: 5000 });
      } catch (e) {}
      
      const beforeHtml = await page.innerHTML('[role="dialog"]');
      
      // Attempt click with a fallback retry in case of detachment
      try {
        await submitBtn.click();
      } catch (clickErr) {
        if (clickErr.message.includes('detached') || clickErr.message.includes('attached') || clickErr.message.includes('visible')) {
          console.log('Submit button detached or blocked. Re-querying and retrying...');
          await page.waitForTimeout(1000);
          const retrySubmitBtn = await page.$('button:has-text("Submit application"), button:has-text("Submit")');
          if (retrySubmitBtn) {
            await retrySubmitBtn.click({ force: true }).catch(() => {});
          } else {
            console.log('Could not find submit button on retry.');
          }
        } else {
          throw clickErr;
        }
      }
      
      // Wait to see if we transition to the success screen or get an error
      let submissionStatus = 'pending';
      try {
        await page.waitForFunction(() => {
          const hasDone = !!document.querySelector('button:has-text("Done")') || !!document.querySelector('button:has-text("Close")');
          const hasSuccessMsg = document.body.innerText.includes('Application sent') || document.body.innerText.includes('Your application was sent');
          const hasError = !!document.querySelector('.artdeco-inline-feedback--error') || !!document.querySelector('[id*="error"]');
          return hasDone || hasSuccessMsg || hasError;
        }, {}, { timeout: 8000 });
        
        const hasError = await page.isVisible('.artdeco-inline-feedback--error, [id*="error"]');
        if (hasError) {
          submissionStatus = 'error';
        } else {
          submissionStatus = 'success';
        }
      } catch (e) {
        // Timeout reached, check current state
        const hasError = await page.isVisible('.artdeco-inline-feedback--error, [id*="error"]');
        if (hasError) {
          submissionStatus = 'error';
        } else {
          const doneBtn = await page.$('button:has-text("Done"), button:has-text("Close")');
          const successMsg = await page.$('h3:has-text("Application sent"), h2:has-text("Application sent"), :has-text("Your application was sent")');
          if (doneBtn || successMsg) {
            submissionStatus = 'success';
          } else {
            submissionStatus = 'unknown';
          }
        }
      }
      
      if (submissionStatus === 'success') {
        const doneBtn = await page.$('button:has-text("Done"), button:has-text("Close")');
        if (doneBtn) {
          await doneBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
        
        // If modal is still visible, click the Dismiss/Cross button
        const isStillVisible = await page.isVisible('[role="dialog"], .artdeco-modal');
        if (isStillVisible) {
          console.log('Modal still visible after Done click. Clicking Dismiss (cross) button...');
          const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss');
          if (dismissBtn) {
            await dismissBtn.click().catch(() => {});
            await page.waitForTimeout(1000);
          }
        }
        
        console.log('Application submitted successfully!');
        await page.screenshot({ path: `screenshot_success_${Date.now()}.png` }).catch(() => {});
        return true;
      } else if (submissionStatus === 'error') {
        // Attempt to auto-correct validation errors
        const corrected = await correctInvalidFields(page);
        if (corrected) {
          console.log('Re-submitting after auto-correction...');
          await submitBtn.click().catch(() => {});
          await page.waitForTimeout(4000);
          
          // Re-evaluate if submission succeeded
          const hasErrorAfter = await page.isVisible('.artdeco-inline-feedback--error, [id*="error"]');
          if (!hasErrorAfter) {
            const doneBtn = await page.$('button:has-text("Done"), button:has-text("Close")');
            if (doneBtn) {
              await doneBtn.click().catch(() => {});
              await page.waitForTimeout(1000);
            }
            
            const isStillVisible = await page.isVisible('[role="dialog"], .artdeco-modal');
            if (isStillVisible) {
              const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss');
              if (dismissBtn) {
                await dismissBtn.click().catch(() => {});
                await page.waitForTimeout(1000);
              }
            }
            console.log('Application submitted successfully after auto-correction!');
            await page.screenshot({ path: `screenshot_success_${Date.now()}.png` }).catch(() => {});
            return true;
          }
        }
        
        console.warn('\n⚠️ Form validation error on submission!');
        console.warn('Please manually resolve the error and submit, or the bot will cancel after 60 seconds.');
        
        try {
          await page.waitForFunction((prevHtml) => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return true;
            const currentHtml = dialog.innerHTML;
            const hasErr = !!document.querySelector('.artdeco-inline-feedback--error');
            const hasDone = !!document.querySelector('button:has-text("Done")') || !!document.querySelector('button:has-text("Close")');
            return (currentHtml !== prevHtml && !hasErr) || hasDone;
          }, beforeHtml, { timeout: 60000 });
          
          console.log('✅ Manual intervention successful after submission error! Resuming...');
          const doneBtn = await page.$('button:has-text("Done"), button:has-text("Close")');
          if (doneBtn) {
            await doneBtn.click().catch(() => {});
            await page.waitForTimeout(1000);
          }
          
          const isStillVisible = await page.isVisible('[role="dialog"], .artdeco-modal');
          if (isStillVisible) {
            const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss');
            if (dismissBtn) {
              await dismissBtn.click().catch(() => {});
              await page.waitForTimeout(1000);
            }
          }
          
          console.log('Application submitted successfully!');
          await page.screenshot({ path: `screenshot_success_${Date.now()}.png` }).catch(() => {});
          return true;
        } catch (e) {
          console.warn('Timeout waiting for manual intervention after submission error. Cancelling...');
          await cancelApplication(page);
          return false;
        }
      } else {
        console.warn('Submission state unknown. Waiting another 10 seconds for success screen...');
        await page.waitForTimeout(10000);
        const doneBtn = await page.$('button:has-text("Done"), button:has-text("Close")');
        if (doneBtn) {
          await doneBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
        
        const isStillVisible = await page.isVisible('[role="dialog"], .artdeco-modal');
        if (isStillVisible) {
          const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss');
          if (dismissBtn) {
            await dismissBtn.click().catch(() => {});
            await page.waitForTimeout(1000);
          }
        }
        
        const isStillVisibleSecondCheck = await page.isVisible('[role="dialog"], .artdeco-modal');
        if (isStillVisibleSecondCheck) {
          console.warn('Still cannot confirm submission. Cancelling application to be safe.');
          await cancelApplication(page);
          return false;
        } else {
          console.log('Application submitted successfully!');
          await page.screenshot({ path: `screenshot_success_${Date.now()}.png` }).catch(() => {});
          return true;
        }
      }
    }
    
    // Check for "Next", "Review", "Continue"
    const nextBtn = await page.$('button:has-text("Next"), button:has-text("Review"), button:has-text("Continue")');
    if (nextBtn) {
      const beforeHtml = await page.innerHTML('[role="dialog"]');
      
      console.log('Clicking Next/Review/Continue...');
      await nextBtn.click();
      await page.waitForTimeout(2500); // Wait for transition
      
      const afterHtml = await page.innerHTML('[role="dialog"]');
      let hasError = await page.isVisible('.artdeco-inline-feedback--error, [id*="error"]');
      
      if (hasError || beforeHtml === afterHtml) {
        // Attempt to auto-correct validation errors
        const corrected = await correctInvalidFields(page);
        if (corrected) {
          console.log('Re-clicking Next after auto-correction...');
          await nextBtn.click();
          await page.waitForTimeout(2500);
          hasError = await page.isVisible('.artdeco-inline-feedback--error, [id*="error"]');
        }
      }
      
      if (hasError || beforeHtml === afterHtml) {
        console.warn('\n⚠️ The bot is stuck on this page! (Validation error or unknown question).');
        console.warn('Please manually answer the question and click "Next" or "Review" in the browser.');
        console.warn('The bot will wait up to 60 seconds for your manual intervention...\n');
        
        try {
          await page.waitForFunction((prevHtml) => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return true;
            const currentHtml = dialog.innerHTML;
            const hasErr = !!document.querySelector('.artdeco-inline-feedback--error');
            return currentHtml !== prevHtml && !hasErr;
          }, beforeHtml, { timeout: 60000 });
          console.log('✅ Manual intervention successful! Resuming automation...');
        } catch (e) {
          console.warn('Timeout waiting for manual intervention. Cancelling application...');
          await cancelApplication(page);
          return false;
        }
      }
    } else {
      console.warn('No Next or Submit button found. Cancelling application...');
      await cancelApplication(page);
      return false;
    }
  }
  
  if (step >= maxSteps) {
    console.warn('Exceeded maximum application wizard steps. Cancelling...');
    await cancelApplication(page);
    return false;
  }
}

async function scrollJobList(page) {
  console.log('Scrolling job list to load all items...');
  const container = await page.$('.jobs-search-results-list, .jobs-search-results-container, [data-viewport-id]');
  if (container) {
    await container.evaluate(async (el) => {
      for (let i = 0; i < 10; i++) {
        el.scrollTop = el.scrollHeight * (i / 10);
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      el.scrollTop = 0;
    });
    await page.waitForTimeout(1500);
  }
}

async function goToNextPage(page) {
  console.log('Navigating to the next page of results...');
  
  // Get current state before navigating
  const activeBtn = await page.$('.artdeco-pagination__button--selected, [aria-current="true"]');
  const oldPageText = activeBtn ? (await activeBtn.innerText()).trim() : '';
  
  const firstCard = await page.$('.jobs-search-results-list__list-item, .job-card-container, [data-occludable-job-id]');
  const oldJobId = firstCard ? await firstCard.getAttribute('data-occludable-job-id') : '';
  
  // Scroll pagination container into view if it exists
  const paginationContainer = await page.$('.artdeco-pagination, [class*="pagination"]');
  if (paginationContainer) {
    await paginationContainer.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
  }
  
  // Selectors for the general "Next" button
  const nextSelectors = [
    'button[aria-label="Next"]',
    '.artdeco-pagination__button--next',
    '.artdeco-pagination button:has-text("Next")',
    '[class*="pagination"] button:has-text("Next")',
    'button:has-text("Next")',
    '.artdeco-button:has-text("Next")'
  ];
  
  let clicked = false;
  
  // Try to find the active page number and click the next one
  if (activeBtn && oldPageText) {
    const currentPageNum = parseInt(oldPageText, 10);
    if (!isNaN(currentPageNum)) {
      const nextPageNum = currentPageNum + 1;
      console.log(`Current page: ${currentPageNum}. Looking for page ${nextPageNum}...`);
      
      const nextPageBtn = await page.$(`button[aria-label="Page ${nextPageNum}"], button:has-text("${nextPageNum}")`);
      if (nextPageBtn) {
        console.log(`Clicking page ${nextPageNum}...`);
        await nextPageBtn.scrollIntoViewIfNeeded().catch(() => {});
        await nextPageBtn.click();
        clicked = true;
      }
    }
  }
  
  // Fallback: Click the generic "Next" button
  if (!clicked) {
    console.log('Checking for generic Next pagination button...');
    for (const selector of nextSelectors) {
      const nextBtn = await page.$(selector);
      if (nextBtn && await nextBtn.isVisible() && await nextBtn.isEnabled()) {
        const isInsideDialog = await nextBtn.evaluate(el => !!el.closest('[role="dialog"], .artdeco-modal'));
        if (isInsideDialog) continue;
        
        console.log(`Found Next button using selector: "${selector}". Clicking...`);
        await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
        await nextBtn.click();
        clicked = true;
        break;
      }
    }
  }
  
  if (clicked) {
    console.log('Waiting for next page results to load (network request to finish)...');
    
    // Wait up to 10 seconds for page to update
    try {
      await page.waitForFunction(({ oldPage, oldJob }) => {
        // Check if page number changed
        const active = document.querySelector('.artdeco-pagination__button--selected, [aria-current="true"]');
        const currentPage = active ? active.innerText.trim() : '';
        if (oldPage && currentPage && currentPage !== oldPage) return true;
        
        // Or check if the first job ID changed
        const firstCard = document.querySelector('.jobs-search-results-list__list-item, .job-card-container, [data-occludable-job-id]');
        const currentJob = firstCard ? firstCard.getAttribute('data-occludable-job-id') : '';
        if (oldJob && currentJob && currentJob !== oldJob) return true;
        
        return false;
      }, { oldPage: oldPageText, oldJob: oldJobId }, { timeout: 10000 });
      console.log('Page transition confirmed!');
    } catch (e) {
      console.log('Timeout waiting for page content to refresh. Using static wait...');
      await page.waitForTimeout(5000);
    }
    return true;
  }
  
  console.log('No next page button found. Reached the end.');
  return false;
}

async function applyToAllJobsOnPage(page, appliedCount, maxApplications) {
  await scrollJobList(page);
  
  const jobListItems = await page.$$('.jobs-search-results-list__list-item, .job-card-container, [data-occludable-job-id]');
  console.log(`Found ${jobListItems.length} job cards on this page.`);
  
  for (let i = 0; i < jobListItems.length; i++) {
    if (appliedCount >= maxApplications) {
      console.log(`Reached maximum application limit of ${maxApplications}. Stopping bot.`);
      return appliedCount;
    }
    
    console.log(`\n----------------------------------------`);
    console.log(`Processing Job Card ${i + 1} of ${jobListItems.length}`);
    
    // Clean up any stray modals before trying to click the card
    await ensureNoModalsOpen(page);
    
    const currentListItems = await page.$$('.jobs-search-results-list__list-item, .job-card-container, [data-occludable-job-id]');
    if (i >= currentListItems.length) {
      console.log(`Index ${i} out of bounds after list refresh. Skipping.`);
      continue;
    }
    
    const card = currentListItems[i];
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    
    const jobTitleEl = await card.$('.job-card-list__title, .job-card-container__link, [class*="job-title"]');
    const jobTitle = jobTitleEl ? await jobTitleEl.innerText() : 'Unknown Title';
    const companyEl = await card.$('.job-card-container__company-name, .artdeco-entity-lockup__subtitle, [class*="company"]');
    const company = companyEl ? await companyEl.innerText() : 'Unknown Company';
    
    console.log(`Job: "${jobTitle.trim()}" at "${company.trim()}"`);
    
    try {
      await card.click();
      await page.waitForTimeout(2000);
    } catch (e) {
      console.error('Failed to click job card:', e.message);
      continue;
    }
    
    const detailsPane = await page.$('.jobs-search__job-details, .job-view-layout, .jobs-details');
    const containerToSearch = detailsPane || page;
    const easyApplyBtn = await containerToSearch.$('button.jobs-apply-button, button:has-text("Easy Apply")');
    
    if (easyApplyBtn) {
      const btnText = await easyApplyBtn.innerText();
      if (btnText.includes('Easy Apply')) {
        console.log('Easy Apply button found! Clicking...');
        await easyApplyBtn.click();
        await page.waitForTimeout(2500);
        
        const success = await handleEasyApplyModal(page);
        if (success) {
          appliedCount++;
          console.log(`Applied successfully! Total applications: ${appliedCount}`);
        } else {
          console.log('Failed or skipped this application.');
        }
      } else {
        console.log(`Button text is "${btnText.trim()}". Not an Easy Apply option.`);
      }
    } else {
      console.log('Easy Apply button not found (already applied or normal apply). Skipping.');
    }
    
    await page.waitForTimeout(1000);
  }
  
  return appliedCount;
}

async function run() {
  const isHeadless = process.env.HEADLESS === 'true' || (config.headless !== undefined ? config.headless : false);
  console.log(`Launching browser (headless: ${isHeadless})...`);
  
  const browser = await chromium.launch({
    headless: isHeadless,
    slowMo: isHeadless ? 0 : 100, // Slows down Playwright operations in headed mode
    args: isHeadless ? ['--no-sandbox', '--disable-setuid-sandbox'] : ['--start-maximized']
  });
  
  const contextOptions = {
    viewport: isHeadless ? { width: 1280, height: 800 } : null
  };
  
  if (hasState && config.platform !== 'other') {
    try {
      const stateRaw = fs.readFileSync('state.json', 'utf8');
      JSON.parse(stateRaw);
      contextOptions.storageState = 'state.json';
      console.log('Using saved session from state.json...');
    } catch (err) {
      console.warn('Warning: state.json is invalid JSON. Proceeding without saved session state:', err.message);
    }
  } else if (config.platform === 'other') {
    console.log('Platform is "other". Ignoring state.json to start a fresh browser context without LinkedIn session.');
  } else {
    console.log('No saved session found. Starting fresh browser context.');
  }

  const context = await browser.newContext(contextOptions);
  
  const page = await context.newPage();
  let appliedCount = 0;
  const maxApplications = config.maxApplications || 25;
  
  console.log(`Navigating to target URL: ${config.targetUrl}`);
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  try {
    if (config.platform === 'other') {
      console.log('Platform is set to "other". Skipping LinkedIn-specific login checks.');
      await page.waitForTimeout(5000);
    } else {
      const isLoginPage = page.url().includes('checkpoint') || page.url().includes('login') || !(await page.$('.jobs-search-results-list, .jobs-search-results-container, [data-viewport-id]'));
      if (isLoginPage) {
        if (isHeadless) {
          console.error('ERROR: Session expired or state.json missing in headless cloud execution. Cannot perform manual login.');
          await browser.close();
          sendNotification('LinkedIn Apply Failed: Session expired or state.json invalid in cloud execution.', {
            event: 'LINKEDIN_APPLY_FAILED',
            error: 'Session expired',
            appliedCount: 0
          });
          process.exit(1);
        }
        console.log('You are not logged in or were redirected to the login screen. Please log in directly in the browser window.');
        console.log('Waiting up to 5 minutes for successful login...');
        await page.waitForFunction(() => {
          return window.location.href.includes('/feed') || !!document.querySelector('.jobs-search-results-list') || !!document.querySelector('#global-nav');
        }, {}, { timeout: 300000 });
        
        console.log('Login detected! Saving session for future runs...');
        await context.storageState({ path: 'state.json' }).catch(() => {});
        
        if (!page.url().includes('currentJobId')) {
          console.log('Navigating back to jobs list...');
          await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
      }
      await page.waitForSelector('.jobs-search-results-list, .jobs-search-results-container, [data-viewport-id]', { timeout: 15000 });
    }
  } catch (e) {
    console.warn('Warning: Login timed out or jobs list selector was not found. Proceeding anyway...');
  }
  
  let hasNextPage = true;
  while (hasNextPage && appliedCount < maxApplications) {
    appliedCount = await applyToAllJobsOnPage(page, appliedCount, maxApplications);
    
    if (appliedCount >= maxApplications) {
      break;
    }
    
    hasNextPage = await goToNextPage(page);
    if (hasNextPage) {
      console.log('Successfully navigated to next page. Waiting for jobs list to load...');
      await page.waitForTimeout(4000);
    }
  }
  
  console.log(`\n========================================`);
  console.log(`Automation finished. Applied to ${appliedCount} jobs.`);
  console.log(`========================================`);
  
  await browser.close();

  const summary = `LinkedIn Easy Apply Completed! Applied to ${appliedCount} jobs successfully.`;
  sendNotification(summary, {
    event: 'LINKEDIN_APPLY_COMPLETED',
    appliedCount,
    targetUrl: config.targetUrl,
    timestamp: new Date().toISOString()
  });
}

run().catch(err => {
  console.error('An error occurred during application automation:', err);
  sendNotification(`LinkedIn Apply Error: ${err.message}`, {
    event: 'LINKEDIN_APPLY_ERROR',
    error: err.message,
    appliedCount: 0
  });
});
