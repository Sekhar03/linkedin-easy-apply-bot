import { test, expect } from '@playwright/test';

test('Auto Apply to Naukri Jobs', async ({ page }) => {
  // Disable the overall test timeout so you have unlimited time to enter OTP
  // and the script has time to loop through all jobs.
  test.setTimeout(0); 

  await page.goto('https://www.naukri.com/');
  await page.getByRole('link', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'Use OTP to Login' }).click();
  await page.getByRole('textbox', { name: 'Enter your 10 digit mobile' }).click();
  
  // Enter the mobile number
  await page.getByRole('textbox', { name: 'Enter your 10 digit mobile' }).fill('8260960591');
  
  // Click Get OTP
  await page.getByRole('button', { name: 'Get OTP' }).click();
  
  console.log("⏳ WAITING FOR MANUAL OTP ENTRY...");
  console.log("Please enter the OTP in the browser window and click Login.");
  
  // The script will PAUSE here indefinitely until you log in 
  // and the 'Opportunities' link appears on the dashboard.
  const opportunitiesLink = page.getByRole('link', { name: 'Opportunities', description: 'Opportunities' });
  await opportunitiesLink.waitFor({ state: 'visible', timeout: 0 });
  
  console.log("✅ LOGIN SUCCESSFUL! Proceeding to the job list...");

  await opportunitiesLink.click();
  await page.getByRole('link', { name: 'View all' }).click();
  
  // Wait for the new page to settle
  await page.waitForLoadState('domcontentloaded');
  
  // Locate all job title links on the current search page
  const jobLinks = page.locator('a.title');
  
  // Wait for at least the first job to load
  await jobLinks.first().waitFor({ state: 'visible', timeout: 30000 });
  
  const count = await jobLinks.count();
  console.log(`Found ${count} jobs on the page. Starting application loop...`);

  for (let i = 0; i < count; i++) {
    console.log(`Processing job ${i + 1} of ${count}...`);
    
    // Clicking a job link opens a new tab in Naukri
    const page1Promise = page.waitForEvent('popup');
    await jobLinks.nth(i).click();
    const page1 = await page1Promise;
    
    await page1.waitForLoadState('domcontentloaded');

    try {
      // Look for the Apply button on the job description page
      const applyButton = page1.getByRole('button', { name: 'Apply' });
      
      // We check if the Apply button is visible (it might not be if already applied)
      if (await applyButton.isVisible({ timeout: 5000 })) {
        await applyButton.click();
        
        // Sometimes it prompts to upload a resume
        const uploadResume = page1.getByText('Upload Resume');
        if (await uploadResume.isVisible({ timeout: 5000 })) {
          await uploadResume.click();
          await page1.locator('input[type="file"]').setInputFiles('CV__Sekhar_Parida.pdf');
        }

        // Wait for a success indicator
        // Naukri usually shows "You have successfully applied"
        await page1.getByText(/successfully applied/i).waitFor({ state: 'visible', timeout: 15000 });
        console.log(`✅ Successfully applied to job ${i + 1}`);
      } else {
        console.log(`⏭️ Skipped job ${i + 1}: 'Apply' button not found (might be already applied or redirects to external site).`);
      }
    } catch (error) {
      console.log(`❌ Failed to apply to job ${i + 1}: ${error.message}`);
    } finally {
      // Ensure the popup is closed before moving to the next job
      await page1.close();
      // Brief pause between applications to avoid getting rate-limited
      await page.waitForTimeout(2000); 
    }
  }
  
  console.log("🎉 Finished processing all jobs on this page.");
});
