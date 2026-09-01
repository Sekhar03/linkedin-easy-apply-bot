const { chromium } = require('playwright');
const fs = require('fs');
const { calculateMatchScore } = require('./aiScore');

let config = {};
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (err) {
  console.error('Error reading config.json:', err.message);
  process.exit(1);
}

const APPLIED_JOBS_FILE = 'applied_jobs.json';
const RANKED_JOBS_FILE = 'ranked_jobs.json';

let appliedJobs = [];
try {
  if (fs.existsSync(APPLIED_JOBS_FILE)) {
    appliedJobs = JSON.parse(fs.readFileSync(APPLIED_JOBS_FILE, 'utf8'));
  }
} catch (err) {
  console.warn('Error reading applied_jobs.json:', err.message);
}

let rankedJobs = [];
try {
  if (fs.existsSync(RANKED_JOBS_FILE)) {
    rankedJobs = JSON.parse(fs.readFileSync(RANKED_JOBS_FILE, 'utf8'));
  }
} catch (err) {
  console.log('No existing ranked_jobs.json found. Starting fresh.');
}

function saveRankedJob(jobId, title, company, probability, link, matchingSkills = [], missingSkills = []) {
  if (!jobId) return;
  const isApplied = appliedJobs.some(j => j.jobId === jobId);
  
  const existingIndex = rankedJobs.findIndex(j => j.jobId === jobId);
  const newJob = {
    jobId,
    title: title.trim(),
    company: company.trim(),
    probability,
    matchingSkills,
    missingSkills,
    isApplied,
    link: link || '',
    timestamp: new Date().toISOString()
  };

  if (existingIndex > -1) {
    rankedJobs[existingIndex] = newJob;
  } else {
    rankedJobs.push(newJob);
  }

  // Sort by isApplied (false first) then by product-specific role priority, and then by probability (highest first)
  rankedJobs.sort((a, b) => {
    if (a.isApplied === b.isApplied) {
      const isProductA = /product/i.test(a.title);
      const isProductB = /product/i.test(b.title);
      if (isProductA !== isProductB) {
        return isProductA ? -1 : 1;
      }
      const probA = a.probability !== null ? a.probability : -1;
      const probB = b.probability !== null ? b.probability : -1;
      return probB - probA;
    }
    return a.isApplied ? 1 : -1;
  });

  try {
    fs.writeFileSync(RANKED_JOBS_FILE, JSON.stringify(rankedJobs, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving ranked jobs:', err.message);
  }
}

async function ensureNoModalsOpen(page) {
    const closeModalBtn = await page.$('button[aria-label="Dismiss"], button[aria-label="Close"], .artdeco-modal__dismiss');
    if (closeModalBtn) {
      await closeModalBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
}

async function rankJobsOnPage(page) {
    await page.waitForSelector('.jobs-search-results-list, .jobs-search-results-container, [data-viewport-id]', { timeout: 15000 }).catch(()=>{});
    
    // Scroll the job list pane
    await page.evaluate(() => {
        const list = document.querySelector('.jobs-search-results-list');
        if (list) {
            list.scrollBy(0, list.scrollHeight);
        } else {
            window.scrollBy(0, document.body.scrollHeight);
        }
    });
    await page.waitForTimeout(1500);
    
    let listItems = await page.$$('.jobs-search-results-list__list-item, .job-card-container, [data-occludable-job-id]');
    console.log(`Found ${listItems.length} jobs on this page.`);

    for (let i = 0; i < listItems.length; i++) {
        await ensureNoModalsOpen(page);
        
        listItems = await page.$$('.jobs-search-results-list__list-item, .job-card-container, [data-occludable-job-id]');
        if (i >= listItems.length) continue;
        
        const card = listItems[i];
        let jobId = await card.getAttribute('data-occludable-job-id') || await card.getAttribute('data-job-id');
        const jobTitleEl = await card.$('.job-card-list__title, .job-card-container__link, [class*="job-title"]');
        const jobTitle = jobTitleEl ? await jobTitleEl.innerText() : 'Unknown Title';
        const companyEl = await card.$('.job-card-container__company-name, .artdeco-entity-lockup__subtitle, [class*="company"]');
        const company = companyEl ? await companyEl.innerText() : 'Unknown Company';
        
        let link = '';
        if (!jobId && jobTitleEl) {
            const href = await jobTitleEl.getAttribute('href');
            if (href) {
                link = 'https://www.linkedin.com' + href;
                const match = href.match(/\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/);
                if (match) jobId = match[1];
            }
        } else if (jobId) {
            link = `https://www.linkedin.com/jobs/view/${jobId}/`;
        }
        
        console.log(`Checking Job: "${jobTitle.trim()}" at "${company.trim()}" (ID: ${jobId || 'N/A'})`);
        
        await card.scrollIntoViewIfNeeded().catch(()=>{});
        await page.waitForTimeout(500);
        
        try {
            await card.click();
            await page.waitForTimeout(2000);
        } catch (e) {
            console.error('Failed to click job card:', e.message);
            continue;
        }

        const detailsPane = await page.$('.jobs-search__job-details, .job-view-layout, .jobs-details');
        const containerToSearch = detailsPane || page;
        
        let matchScore = null;
        let matchingSkills = [];
        let missingSkills = [];
        try {
            const descEl = await containerToSearch.$('.jobs-description__content, .jobs-description-content__text, #job-details, .job-view-layout');
            if (descEl) {
                const descText = await descEl.innerText();
                console.log('Calculating Match Probability...');
                const matchResult = await calculateMatchScore(descText, jobTitle);
                if (matchResult !== null) {
                    matchScore = matchResult.score;
                    matchingSkills = matchResult.matchingSkills;
                    missingSkills = matchResult.missingSkills;
                }
                console.log(`Match Probability: ${matchScore !== null ? matchScore + '%' : 'N/A'}`);
                console.log(`Matching Skills: ${matchingSkills.join(', ') || 'None'}`);
                console.log(`Missing Skills: ${missingSkills.join(', ') || 'None'}`);
            }
        } catch (err) {
            console.error('Error calculating Match Probability:', err.message);
        }

        saveRankedJob(jobId, jobTitle, company, matchScore, link, matchingSkills, missingSkills);
        await page.waitForTimeout(500);
    }
}

async function goToNextPage(page) {
    const paginationList = await page.$$('ul.artdeco-pagination__pages li button');
    if (paginationList.length > 0) {
      let activeIndex = -1;
      for (let i = 0; i < paginationList.length; i++) {
        const isActive = await paginationList[i].evaluate(el => el.parentElement.classList.contains('active'));
        if (isActive) {
          activeIndex = i;
          break;
        }
      }
      
      if (activeIndex !== -1 && activeIndex < paginationList.length - 1) {
        console.log(`Moving to page ${activeIndex + 2}...`);
        await paginationList[activeIndex + 1].click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        return true;
      }
    }
    
    // Check for next button if pagination pages not clearly found
    const nextBtn = await page.$('button[aria-label="Next"], button.artdeco-pagination__button--next');
    if (nextBtn) {
      const isDisabled = await nextBtn.evaluate(el => el.hasAttribute('disabled'));
      if (!isDisabled) {
        console.log('Clicking Next button...');
        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        return true;
      }
    }
    
    console.log('No more pages found.');
    return false;
}

async function run() {
    console.log('Launching browser for Ranking mode...');
    const hasState = fs.existsSync('state.json');
    
    const browser = await chromium.launch({
      headless: config.headless !== undefined ? config.headless : false,
      slowMo: 100,
      args: ['--start-maximized']
    });
    
    const contextOptions = { viewport: null };
    if (hasState) {
      contextOptions.storageState = 'state.json';
    }
  
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    
    console.log(`Navigating to target URL: ${config.targetUrl}`);
    try {
      await page.goto(config.targetUrl, { waitUntil: 'commit', timeout: 60000 });
    } catch (e) {}

    const isLoginPage = page.url().includes('checkpoint') || page.url().includes('login') || !(await page.$('.jobs-search-results-list, .jobs-search-results-container, [data-viewport-id]'));
    if (isLoginPage) {
        console.log('Login required. Please login directly in the browser.');
        await page.waitForFunction(() => {
          return window.location.href.includes('/feed') || !!document.querySelector('.jobs-search-results-list') || !!document.querySelector('#global-nav');
        }, {}, { timeout: 300000 }).catch(()=>{});
        
        await context.storageState({ path: 'state.json' }).catch(() => {});
        if (!page.url().includes('currentJobId')) {
            await page.goto(config.targetUrl, { waitUntil: 'commit', timeout: 60000 }).catch(()=>{});
        }
    }
    
    let hasNextPage = true;
    let pageCount = 0;
    while (hasNextPage && pageCount < 10) { // arbitrary limit so it doesn't run forever
      await rankJobsOnPage(page);
      hasNextPage = await goToNextPage(page);
      pageCount++;
    }

    console.log('\nRanking completed successfully. Check ranked_jobs.json.');
    await browser.close();
}

run();
