const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper service running' });
});

// FULL SCRAPER ENDPOINT
app.post('/scrape-full', async (req, res) => {
  const { url, options = {} } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url"' });
  }

  const {
    waitUntil = 'domcontentloaded',
    maxLinks = 1000,
    maxImages = 500,
    includeText = false
  } = options;

  let browser;
  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    // Create context with viewport + UA
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Navigate
    await page.goto(url, {
      waitUntil,
      timeout: 60000,
    });

    // Allow initial content to settle
    await page.waitForTimeout(3000);

    // Scroll to bottom to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 800;
        const timer = setInterval(() => {
          const { scrollHeight } = document.body;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 400);
      });
    });

    // Small pause after scrolling
    await page.waitForTimeout(2000);

    // Extract data
    const data = await page.evaluate(
      ({ maxLinks, maxImages, includeText }) => {
        const out = {
          url: window.location.href,
          title: document.title || null,
          meta: [],
          openGraph: [],
          jsonLd: [],
          headings: [],
          links: [],
          images: [],
          scripts: [],
          stylesheets: [],
          textBlocks: [],
          fullText: null,
          sections: []
        };

        // Meta tags
        out.meta = Array.from(document.querySelectorAll('meta')).map((m) => ({
          name: m.getAttribute('name'),
          property: m.getAttribute('property'),
          content: m.getAttribute('content'),
        }));

        // Open Graph tags
        out.openGraph = Array.from(
          document.querySelectorAll('meta[property^="og:"]'),
        ).map((m) => ({
          property: m.getAttribute('property'),
          content: m.getAttribute('content'),
        }));

        // JSON-LD
        out.jsonLd = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        ).map((s) => {
          const raw = s.textContent || '';
          try {
            return JSON.parse(raw);
          } catch {
            return raw.trim();
          }
        });

        // Headings
        out.headings = Array.from(
          document.querySelectorAll('h1, h2, h3, h4'),
        ).map((h) => ({
          tag: h.tagName.toLowerCase(),
          text: (h.innerText || '').trim(),
        }));

        // Links
        out.links = Array.from(document.querySelectorAll('a[href]'))
          .slice(0, maxLinks)
          .map((a) => ({
            href: a.href,
            text: (a.innerText || '').trim(),
          }));

        // Images
        out.images = Array.from(document.querySelectorAll('img[src]'))
          .slice(0, maxImages)
          .map((img) => ({
            src: img.src,
            alt: img.alt || null,
          }));

        // Script URLs
        out.scripts = Array.from(document.querySelectorAll('script[src]')).map(
          (s) => s.src,
        );

        // Stylesheets
        out.stylesheets = Array.from(
          document.querySelectorAll('link[rel="stylesheet"]'),
        ).map((l) => l.href);

        // Optional text extraction
        if (includeText) {
          // FULL VISIBLE TEXT (best for AI)
          out.fullText = (document.body.innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500_000);

          // PARAGRAPH / BLOCK TEXT
          const blockSelectors = 'p, li, td, th, dt, dd, span, div';
          out.textBlocks = Array.from(
            document.querySelectorAll(blockSelectors),
          )
            .map((el) => (el.innerText || '').trim())
            .filter((t) => t.length > 0)
            .slice(0, 1000);

          // SECTIONED LOGIC (headline → text blocks)
          const sections = [];
          let currentSection = { heading: null, text: [] };

          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
          );

          while (walker.nextNode()) {
            const el = walker.currentNode;

            if (/^H[1-4]$/.test(el.tagName)) {
              if (currentSection.heading || currentSection.text.length) {
                sections.push(currentSection);
              }
              currentSection = {
                heading: (el.innerText || '').trim(),
                text: []
              };
            } else if (
              ['P', 'DIV', 'LI', 'SPAN', 'TD', 'TH'].includes(el.tagName)
            ) {
              const text = (el.innerText || '').trim();
              if (text) currentSection.text.push(text);
            }
          }

          if (currentSection.heading || currentSection.text.length) {
            sections.push(currentSection);
          }

          out.sections = sections;
        }

        return out;
      },
      { maxLinks, maxImages, includeText },
    );

    res.json({
      scrapedAt: new Date().toISOString(),
      data,
    });
  } catch (err) {
    console.error('SCRAPE ERROR:', err);
    res.status(500).json({
      error: 'Scrape failed',
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Render expected port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scraper service listening on port ${port}`);
});
