document.addEventListener('DOMContentLoaded', () => {
  // Initialize icons
  lucide.createIcons();

  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const targetUrlInput = document.getElementById('targetUrl');
  const platformInput = document.getElementById('platform');
  const maxApplicationsInput = document.getElementById('maxApplications');
  const headlessInput = document.getElementById('headless');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('resumeFile');
  const uploadedFilename = document.getElementById('uploadedFilename');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const controlForm = document.getElementById('controlForm');
  
  const accordionTrigger = document.getElementById('accordionTrigger');
  const accordionContent = document.getElementById('accordionContent');
  const answersGrid = document.getElementById('answersGrid');
  const saveAnswersBtn = document.getElementById('saveAnswersBtn');

  const logConsole = document.getElementById('logConsole');
  const autoscrollBtn = document.getElementById('autoscrollBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const copyLogsBtn = document.getElementById('copyLogsBtn');
  
  const statProcessed = document.getElementById('statProcessed');
  const statSuccess = document.getElementById('statSuccess');
  const statInterventions = document.getElementById('statInterventions');
  
  const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
  const historyTableBody = document.getElementById('historyTableBody');

  // State
  let isAutoScroll = true;
  let currentConfig = {};
  let currentFile = null;

  // --- Initialize Config ---
  fetchConfig();

  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        currentConfig = await res.json();
        populateForm(currentConfig);
      }
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  }

  function populateForm(config) {
    if (config.targetUrl) targetUrlInput.value = config.targetUrl;
    if (config.platform) platformInput.value = config.platform;
    if (config.maxApplications !== undefined) maxApplicationsInput.value = config.maxApplications;
    if (config.headless !== undefined) headlessInput.checked = config.headless;
    if (config.resumePath) uploadedFilename.textContent = `Current: ${config.resumePath}`;

    if (config.defaultAnswers) {
      renderAnswersGrid(config.defaultAnswers);
    }
  }

  function renderAnswersGrid(answers) {
    answersGrid.innerHTML = '';
    const keys = Object.keys(answers);
    
    // Sort keys alphabetically for neatness
    keys.sort().forEach(key => {
      const val = answers[key];
      const div = document.createElement('div');
      div.className = 'answer-field';
      div.innerHTML = `
        <label>${key}</label>
        <input type="text" data-key="${key}" value="${val.replace(/"/g, '&quot;')}">
      `;
      answersGrid.appendChild(div);
    });
  }

  // --- Accordion Logic ---
  accordionTrigger.addEventListener('click', () => {
    const parent = accordionTrigger.parentElement;
    parent.classList.toggle('open');
  });

  saveAnswersBtn.addEventListener('click', async () => {
    const inputs = answersGrid.querySelectorAll('input[data-key]');
    const updatedAnswers = {};
    inputs.forEach(inp => {
      updatedAnswers[inp.getAttribute('data-key')] = inp.value;
    });

    currentConfig.defaultAnswers = updatedAnswers;
    
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentConfig)
      });
      if (res.ok) {
        alert('Answers saved successfully!');
      } else {
        alert('Failed to save answers.');
      }
    } catch (err) {
      alert('Error saving answers.');
    }
  });

  // --- File Upload UI Logic ---
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    currentFile = file;
    uploadedFilename.textContent = file.name;
    uploadedFilename.style.color = '#10b981'; // Green to indicate new selection
  }

  // --- Automation Start/Stop ---
  controlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // First, if there's a file, upload it
    if (currentFile) {
      const formData = new FormData();
      formData.append('resume', currentFile);
      try {
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        if (!uploadRes.ok) throw new Error('File upload failed');
        currentFile = null; // Clear so we don't upload again
        uploadedFilename.style.color = ''; // Reset color
      } catch (err) {
        alert('Error uploading file: ' + err.message);
        return;
      }
    }

    // Now start the automation
    const payload = {
      targetUrl: targetUrlInput.value,
      platform: platformInput.value,
      maxApplications: maxApplicationsInput.value,
      headless: headlessInput.checked
    };

    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Error starting bot: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error starting bot: ' + err.message);
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error('Error stopping bot', err);
    }
  });

  // --- Real-time SSE Connection ---
  const eventSource = new EventSource('/api/logs');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'status') {
      updateStatus(data.status);
    } else if (data.type === 'log') {
      appendLog(data.message);
    } else if (data.type === 'init-logs') {
      data.logs.forEach(log => appendLog(log));
    }
  };

  eventSource.onerror = () => {
    updateStatus('disconnected');
  };

  function updateStatus(status) {
    statusDot.className = 'status-dot';
    statusDot.classList.add(status);
    
    // Update Text
    if (status === 'disconnected') {
      statusText.textContent = 'DISCONNECTED';
      statusText.style.color = 'var(--color-error)';
    } else {
      statusText.textContent = status.toUpperCase();
      statusText.style.color = '';
    }

    // Update Buttons
    if (status === 'running') {
      startBtn.disabled = true;
      stopBtn.disabled = false;
      document.querySelector('.logo-icon i').classList.add('pulse-icon');
    } else if (status === 'idle' || status === 'completed' || status === 'stopped' || status === 'error') {
      startBtn.disabled = false;
      stopBtn.disabled = true;
      document.querySelector('.logo-icon i').classList.remove('pulse-icon');
    }
  }

  function appendLog(message) {
    const lines = message.split('\n');
    lines.forEach(line => {
      if (line.trim() === '') return;
      
      const div = document.createElement('div');
      div.className = 'log-line';
      
      // Basic color parsing based on content
      const lower = line.toLowerCase();
      if (lower.includes('error') || lower.includes('fail') || line.includes('⚠️')) {
        div.classList.add('error');
      } else if (lower.includes('success') || lower.includes('✅') || lower.includes('done')) {
        div.classList.add('success');
      } else if (lower.includes('warn') || lower.includes('skipping')) {
        div.classList.add('warning');
      } else if (lower.includes('click') || lower.includes('found')) {
        div.classList.add('info');
      }

      div.textContent = line;
      logConsole.appendChild(div);
      
      // Update stats based on log stream
      if (line.includes('Total applications:')) {
        const match = line.match(/Total applications:\s*(\d+)/);
        if (match) statSuccess.textContent = match[1];
      }
      if (line.includes('Processing Job Card')) {
        const match = line.match(/Processing Job Card (\d+)/);
        if (match) statProcessed.textContent = parseInt(statProcessed.textContent) + 1;
      }
      if (line.includes('⚠️')) {
        statInterventions.textContent = parseInt(statInterventions.textContent) + 1;
      }
    });

    if (isAutoScroll) {
      logConsole.scrollTop = logConsole.scrollHeight;
    }
  }

  // --- Terminal Buttons ---
  autoscrollBtn.addEventListener('click', () => {
    isAutoScroll = !isAutoScroll;
    autoscrollBtn.classList.toggle('active', isAutoScroll);
  });

  clearLogsBtn.addEventListener('click', () => {
    logConsole.innerHTML = '<div class="log-line system-msg">[System] Logs cleared.</div>';
  });

  copyLogsBtn.addEventListener('click', async () => {
    const text = logConsole.innerText;
    try {
      await navigator.clipboard.writeText(text);
      const icon = copyLogsBtn.querySelector('i');
      const originalHtml = copyLogsBtn.innerHTML;
      copyLogsBtn.innerHTML = `<i data-lucide="check"></i> Copied`;
      lucide.createIcons();
      setTimeout(() => {
        copyLogsBtn.innerHTML = originalHtml;
        lucide.createIcons();
      }, 2000);
    } catch (err) {
      alert('Failed to copy logs');
    }
  });

});
