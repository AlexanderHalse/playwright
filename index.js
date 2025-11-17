const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Simple health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Playwright service running' });
});

// Example: screenshot endpoint
app.post('/screenshot', async (req, res) => {
  const { url, fullPage } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" in body' });
  }

  let browser;
  try {
    browser = await chromium.launch({
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      headless: true
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    const buffer = await page.screenshot({ fullPage: !!fullPage });

    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error', details: String(err) });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Use Render's PORT env
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Playwright service listening on port ${port}`);
});
