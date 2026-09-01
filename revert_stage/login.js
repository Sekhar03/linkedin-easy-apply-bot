const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  console.log('Launching browser for manual login...');
  console.log('Please log into your LinkedIn account in the browser window.');
  console.log('Once you are logged in and see the LinkedIn feed/home page, this script will automatically detect it and save your session.');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null
  });

  const page = await context.newPage();
  
  // Go to LinkedIn Login page
  await page.goto('https://www.linkedin.com/login');

  try {
    // Wait for the URL to change to feed, or for the global navigation bar to appear, indicating a successful login.
    // We give the user 5 minutes (300,000 ms) to complete login / pass any MFA verification.
    await page.waitForFunction(() => {
      return window.location.href.includes('/feed') || !!document.querySelector('#global-nav');
    }, {}, { timeout: 300000 });

    console.log('Login detected! Waiting a few seconds for cookies/session to settle...');
    await page.waitForTimeout(5000);

    // Save session storage state
    await context.storageState({ path: 'state.json' });
    console.log('Session state successfully saved to state.json!');
  } catch (error) {
    console.error('Login timed out or failed. Session state was not saved.', error.message);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run().catch(err => {
  console.error('An error occurred during login setup:', err);
});
