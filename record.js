process.env.PWDEBUG = '1';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

async function record() {
  console.log('====================================================');
  console.log('🎬 Launching Stealth Codegen / Recorder for Google Careers');
  console.log('====================================================');

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
    console.log(`🌐 Launching Stealth Brave Browser (${bravePath})...`);
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        executablePath: bravePath
      });
      console.log('✅ Stealth Brave Browser connected.');
    } catch (err) {
      console.warn('⚠️ Could not launch Brave directly, falling back:', err.message);
    }
  }

  if (!context) {
    console.log('🌐 Launching Stealth Google Chrome Browser...');
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        channel: 'chrome'
      });
    } catch (err) {
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    }
  }

  // Inject anti-detection stealth scripts
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

  const targetUrl = 'https://www.google.com/about/careers/applications/jobs/saved?location=India&target_level=EARLY&target_level=INTERN_AND_APPRENTICE&degree=BACHELORS&employment_type=PART_TIME&employment_type=TEMPORARY&employment_type=INTERN&employment_type=FULL_TIME&sort_by=date&page=2';

  console.log(`🌐 Navigating to: ${targetUrl}`);
  await page.goto(targetUrl);

  console.log('\n💡 INSTRUCTIONS:');
  console.log('1. Playwright Inspector code recorder window is now open!');
  console.log('2. Sign in to your Google Account (if prompted) & perform the 1st job application.');
  console.log('3. All steps will be recorded cleanly in the Inspector.');
  console.log('4. Close the browser when done.\n');

  // Pause to open Playwright Inspector on the stealth browser
  await page.pause();

  await context.close();
}

record().catch(err => {
  console.error('❌ Recording failed:', err);
});
