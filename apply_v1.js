const { chromium } = require('playwright');
const fs = require('fs');

// Read config
let config = {};
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (err) {
  console.error('Error reading config.json:', err.message);
  process.exit(1);
}

// Verify state.json exists
if (!fs.existsSync('state.json')) {
  console.error('ERROR: state.json not found! Please run manual login first:');
  console.error('npm run login');
  process.exit(1);
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
      const nonPlaceholder = options.find(o => o.value !== '' && o.text.toLowerCase() !== 'select');
      selectedValue = nonPlaceholder ? nonPlaceholder.value : options[0].value;
    }
    
    if (selectedValue) {
      console.log(`  Selected option: "${selectedValue}" (matched key: ${matchedKey || 'none/fallback'})`);
      await select.selectOption(selectedValue);
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
      const isNumeric = type === 'number' || questionText.toLowerCase().includes('years') || questionText.toLowerCase().includes('experience') || questionText.toLowerCase().includes('how many');
      if (isNumeric) {
        answer = config.defaultAnswers['experience'] || '3';
      } else {
        answer = 'Yes'; // generic fallback text
      }
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
      if (id) {
        const label = await page.$(`label[for="${id}"]`);
        if (label) labelText = await label.innerText();
      }
      if (!labelText) {
        labelText = await radio.evaluate(el => el.nextElementSibling ? el.nextElementSibling.innerText : '');
      }
      
      labelText = labelText.trim().toLowerCase();
      if (labelText.includes(answer) || (answer === 'yes' && labelText === 'yes') || (answer === 'no' && labelText === 'no')) {
        console.log(`  Checking radio option: "${labelText}"`);
        await radio.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked && group.length > 0) {
      console.log(`  No matching radio found. Checking first option by default.`);
      await group[0].click();
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
      await checkbox.check();
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
}

async function cancelApplication(page) {
  console.log('Cancelling and discarding application...');
  const dismissBtn = await page.$('[role="dialog"] button[aria-label="Dismiss"], [role="dialog"] button.artdeco-modal__dismiss, [role="dialog"] button:has-text("Cancel")');
  if (dismissBtn) {
    await dismissBtn.click();
    await page.waitForTimeout(1000);
    
    const discardBtn = await page.$('button:has-text("Discard"), button:has-text("Yes, discard"), button[data-control-name="discard_application_confirm_btn"]');
    if (discardBtn) {
      await discardBtn.click();
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
      await submitBtn.click();
      await page.waitForTimeout(4000); // Wait for submission confirmation
      
      // Look for a close/done button on completion screen
      const doneBtn = await page.$('button:has-text("Done"), button:has-text("Close"), button[aria-label="Dismiss"]');
      if (doneBtn) {
        await doneBtn.click();
        await page.waitForTimeout(1000);
      }
      console.log('Application submitted successfully!');
      return true;
    }
    
    // Check for "Next", "Review", "Continue"
    const nextBtn = await page.$('button:has-text("Next"), button:has-text("Review"), button:has-text("Continue")');
    if (nextBtn) {
      const beforeHtml = await page.innerHTML('[role="dialog"]');
      
      console.log('Clicking Next/Review/Continue...');
      await nextBtn.click();
      await page.waitForTimeout(2500); // Wait for transition
      
      const afterHtml = await page.innerHTML('[role="dialog"]');
      const hasError = await page.isVisible('.artdeco-inline-feedback--error, [id*="error"]');
      
      if (hasError || beforeHtml === afterHtml) {
        console.warn('Form validation error or unable to advance page. Cancelling application...');
        await cancelApplication(page);
        return false;
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
  
  const activeBtn = await page.$('.artdeco-pagination__button--selected, [aria-current="true"]');
  if (!activeBtn) {
    console.log('Could not find active page button. Checking for default Next pagination button...');
    const nextPageBtn = await page.$('button[aria-label="Next"], .artdeco-pagination__button--next');
    if (nextPageBtn && await nextPageBtn.isEnabled()) {
      await nextPageBtn.click();
      await page.waitForTimeout(5000);
      return true;
    }
    return false;
  }
  
  const activeText = await activeBtn.innerText();
  const currentPageNum = parseInt(activeText.trim(), 10);
  if (isNaN(currentPageNum)) {
    console.log('Unable to parse current page number:', activeText);
    return false;
  }
  
  const nextPageNum = currentPageNum + 1;
  console.log(`Current page: ${currentPageNum}. Looking for page ${nextPageNum}...`);
  
  const nextPageBtn = await page.$(`button[aria-label="Page ${nextPageNum}"], button:has-text("${nextPageNum}")`);
  if (nextPageBtn) {
    console.log(`Clicking page ${nextPageNum}...`);
    await nextPageBtn.click();
    await page.waitForTimeout(5000);
    return true;
  } else {
    const nextBtn = await page.$('button[aria-label="Next"], .artdeco-pagination__button--next');
    if (nextBtn && await nextBtn.isEnabled()) {
      console.log('Clicking Next page button...');
      await nextBtn.click();
      await page.waitForTimeout(5000);
      return true;
    }
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
  console.log('Launching browser using saved session...');
  
  const browser = await chromium.launch({
    headless: config.headless !== undefined ? config.headless : false,
    args: ['--start-maximized']
  });
  
  const context = await browser.newContext({
    storageState: 'state.json',
    viewport: null
  });
  
  const page = await context.newPage();
  let appliedCount = 0;
  const maxApplications = config.maxApplications || 25;
  
  console.log(`Navigating to target URL: ${config.targetUrl}`);
  await page.goto(config.targetUrl);
  
  try {
    await page.waitForSelector('.jobs-search-results-list, .jobs-search-results-container, [data-viewport-id]', { timeout: 15000 });
  } catch (e) {
    console.warn('Warning: Jobs list selector was not found. Proceeding anyway...');
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
}

run().catch(err => {
  console.error('An error occurred during application automation:', err);
});
