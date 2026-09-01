const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for CV uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, __dirname);
  },
  filename: function (req, file, cb) {
    // Keep original filename or sanitize it slightly
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}${ext}`);
  }
});
const upload = multer({ storage: storage });

// Bot State management
let currentProcess = null;
let botStatus = 'idle'; // 'idle', 'running', 'completed', 'stopped', 'error'
let logBuffer = [];
let clients = [];

// Helper to broadcast status/logs to all connected clients
function broadcast(type, payload) {
  const eventString = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  clients.forEach(client => {
    client.res.write(eventString);
  });
}

function appendLog(message) {
  logBuffer.push(message);
  if (logBuffer.length > 2000) {
    logBuffer.shift();
  }
  broadcast('log', { message });
}

function setStatus(status) {
  botStatus = status;
  broadcast('status', { status });
}

// 1. SSE Endpoint for Logs and Status
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current status immediately
  res.write(`data: ${JSON.stringify({ type: 'status', status: botStatus })}\n\n`);

  // Send historical logs in one go
  if (logBuffer.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'init-logs', logs: logBuffer })}\n\n`);
  }

  const client = { id: Date.now(), res };
  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== client.id);
  });
});

// 2. GET current configuration
app.get('/api/config', (req, res) => {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return res.json(configData);
    } else {
      return res.status(404).json({ error: 'Config file not found' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read config.json: ' + err.message });
  }
});

// 3. POST save configuration
app.post('/api/config', (req, res) => {
  const configPath = path.join(__dirname, 'config.json');
  try {
    const newConfig = req.body;
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    return res.json({ success: true, config: newConfig });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save config.json: ' + err.message });
  }
});

// 4. POST Upload Resume
app.post('/api/upload', upload.single('resume'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Update resumePath in config.json
  const configPath = path.join(__dirname, 'config.json');
  try {
    let configData = {};
    if (fs.existsSync(configPath)) {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    configData.resumePath = req.file.filename;
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

    return res.json({ 
      success: true, 
      filename: req.file.filename,
      resumePath: configData.resumePath
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update resume path in config.json: ' + err.message });
  }
});

// 5. POST Start Bot
app.post('/api/start', (req, res) => {
  if (currentProcess) {
    return res.status(400).json({ error: 'Bot is already running' });
  }

  const { targetUrl, platform, maxApplications, headless, defaultAnswers } = req.body;

  // 1. Update config first
  const configPath = path.join(__dirname, 'config.json');
  try {
    let configData = {};
    if (fs.existsSync(configPath)) {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    if (targetUrl) configData.targetUrl = targetUrl;
    if (platform) configData.platform = platform;
    if (maxApplications !== undefined) configData.maxApplications = parseInt(maxApplications, 10);
    if (headless !== undefined) configData.headless = headless;
    if (defaultAnswers) {
      configData.defaultAnswers = {
        ...configData.defaultAnswers,
        ...defaultAnswers
      };
    }

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update config before run: ' + err.message });
  }

  // 2. Start the process
  logBuffer = [];
  setStatus('running');
  appendLog('Starting LinkedIn Apply Automation bot process...\n');

  currentProcess = spawn('node', ['apply.js'], {
    cwd: __dirname,
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  currentProcess.stdout.on('data', (data) => {
    appendLog(data.toString());
  });

  currentProcess.stderr.on('data', (data) => {
    appendLog(data.toString());
  });

  currentProcess.on('close', (code) => {
    currentProcess = null;
    if (botStatus === 'running') {
      if (code === 0) {
        setStatus('completed');
        appendLog('\nBot finished running successfully.');
      } else {
        setStatus('error');
        appendLog(`\nBot process crashed with exit code ${code}`);
      }
    } else {
      appendLog(`\nBot process stopped (exit code ${code}).`);
    }
  });

  return res.json({ success: true });
});

// 6. POST Stop Bot
app.post('/api/stop', (req, res) => {
  if (!currentProcess) {
    return res.status(400).json({ error: 'Bot is not running' });
  }

  setStatus('stopped');
  appendLog('\nStopping bot manually...');
  
  // Kill process
  try {
    currentProcess.kill('SIGINT');
  } catch (e) {
    appendLog(`Failed to stop process gracefully: ${e.message}`);
  }

  return res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
