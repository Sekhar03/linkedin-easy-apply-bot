const fs = require('fs');
const path = require('path');

const APPLIED_JOBS_FILE = path.join(__dirname, 'applied_jobs.json');
const REPORT_FILE = path.join(__dirname, 'applied_jobs_report.html');

function generateHtmlReport() {
  console.log('Generating statistics report...');
  let jobs = [];
  try {
    if (fs.existsSync(APPLIED_JOBS_FILE)) {
      jobs = JSON.parse(fs.readFileSync(APPLIED_JOBS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading applied jobs list:', e.message);
    return;
  }

  const totalProcessed = jobs.length;
  const appliedCount = jobs.filter(j => j.company !== 'Skipped/External' && !(j.aiAnalysis || '').includes('Skipped:')).length;
  const skippedCount = totalProcessed - appliedCount;
  
  const highMatchJobs = jobs.filter(j => (j.probability !== null ? j.probability : 0) >= 70);
  const avgMatchScore = Math.round(jobs.reduce((acc, j) => acc + (j.probability || 0), 0) / (totalProcessed || 1));

  // Build the table rows
  const tableRows = jobs.map(j => {
    const isSkipped = j.company === 'Skipped/External' || (j.aiAnalysis || '').includes('Skipped:');
    const badgeClass = isSkipped ? 'bg-warning text-dark' : 'bg-success';
    const scoreBadge = j.probability !== null ? `<span class="badge ${j.probability >= 70 ? 'bg-primary' : 'bg-secondary'}">${j.probability}%</span>` : '<span class="badge bg-secondary">N/A</span>';
    
    return `
      <tr>
        <td>${new Date(j.timestamp).toLocaleDateString()}</td>
        <td><strong>${j.title}</strong></td>
        <td>${j.company}</td>
        <td>${scoreBadge}</td>
        <td><span class="badge ${badgeClass}">${isSkipped ? 'Skipped' : 'Applied'}</span></td>
        <td><small class="text-muted">${j.aiAnalysis || 'No analysis available'}</small></td>
      </tr>
    `;
  }).join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Easy Apply Bot - Dashboard Report</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background-color: #f8f9fa; }
    .card-stat { border-left: 4px solid; }
  </style>
</head>
<body>
  <div class="container my-5">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h1 class="h2 text-dark">🎯 Easy Apply Bot Application Dashboard</h1>
      <span class="text-muted">Report Generated: ${new Date().toLocaleString()}</span>
    </div>

    <!-- Stats summary grid -->
    <div class="row g-4 mb-5">
      <div class="col-md-3">
        <div class="card p-3 shadow-sm card-stat border-success bg-white">
          <div class="text-muted small uppercase font-weight-bold">Total Applied</div>
          <div class="h3 font-weight-bold text-success">${appliedCount}</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card p-3 shadow-sm card-stat border-warning bg-white">
          <div class="text-muted small">Total Skipped</div>
          <div class="h3 font-weight-bold text-warning">${skippedCount}</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card p-3 shadow-sm card-stat border-primary bg-white">
          <div class="text-muted small">Avg Match Score</div>
          <div class="h3 font-weight-bold text-primary">${avgMatchScore}%</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card p-3 shadow-sm card-stat border-info bg-white">
          <div class="text-muted small">High Quality Matches (>=70%)</div>
          <div class="h3 font-weight-bold text-info">${highMatchJobs.length}</div>
        </div>
      </div>
    </div>

    <!-- Jobs processed table -->
    <div class="card shadow-sm">
      <div class="card-header bg-white py-3">
        <h5 class="card-title mb-0 text-dark">Job Application Log</h5>
      </div>
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Date</th>
              <th>Job Title</th>
              <th>Company</th>
              <th>Match Score</th>
              <th>Status</th>
              <th>Analysis / Reason</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="6" class="text-center text-muted py-4">No jobs processed yet in this session.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(REPORT_FILE, htmlContent, 'utf8');
  console.log(`\n✅ Dashboard report successfully created: ${REPORT_FILE}`);
}

module.exports = {
  generateHtmlReport
};

if (require.main === module) {
  generateHtmlReport();
}
