const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function sendNotification(message, extraData = {}) {
  let config = {};
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}

  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken;
  const chatId = process.env.TELEGRAM_CHAT_ID || config.telegramChatId;
  const webhookUrl = process.env.N8N_WEBHOOK_URL || config.webhookUrl;

  if (token && chatId) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      res.on('data', () => {});
    });
    req.on('error', (err) => {
      console.warn('Failed to send Telegram notification:', err.message);
    });
    req.write(body);
    req.end();
  }

  if (webhookUrl) {
    const payload = {
      event: extraData.event || 'LINKEDIN_APPLY_COMPLETED',
      text: message,
      message: message,
      email: extraData.email || (config.defaultAnswers && config.defaultAnswers.email) || 'sekharparida2003@gmail.com',
      appliedCount: extraData.appliedCount !== undefined ? extraData.appliedCount : 0,
      timestamp: new Date().toISOString(),
      ...extraData
    };

    const body = JSON.stringify(payload);
    try {
      const parsedUrl = new URL(webhookUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const req = client.request(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        console.log(`Notification webhook triggered. Status: ${res.statusCode}`);
        res.on('data', () => {});
      });
      req.on('error', (err) => {
        console.warn('Failed to send webhook notification:', err.message);
      });
      req.write(body);
      req.end();
    } catch (err) {
      console.warn('Invalid webhook URL:', err.message);
    }
  }
}

module.exports = {
  sendNotification
};

