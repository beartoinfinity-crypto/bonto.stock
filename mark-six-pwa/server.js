const express = require('express');
const https = require('https');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'marksix.db');

app.use(express.json());
app.use(express.static(path.join(__dirname)));

let db;

function initDB() {
  const dir = path.dirname(DB_PATH);
  const fs = require('fs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS draws (
      draw TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      numbers TEXT NOT NULL,
      special INTEGER,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_date ON draws(date);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function dbGetDraws(limit) {
  return db.prepare("SELECT * FROM draws ORDER BY substr(date,7,4)||substr(date,4,2)||substr(date,1,2) DESC, draw DESC LIMIT ?").all(limit);
}

function dbGetDrawsByYear(year) {
  return db.prepare("SELECT * FROM draws WHERE date LIKE ? ORDER BY substr(date,7,4)||substr(date,4,2)||substr(date,1,2) DESC, draw DESC").all(`%/${year}`);
}

function dbGetDrawsRange(from, to) {
  const rows = db.prepare("SELECT * FROM draws ORDER BY substr(date,7,4)||substr(date,4,2)||substr(date,1,2) DESC, draw DESC").all();
  return rows.filter(d => {
    const iso = d.date.split('/').reverse().join('');
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  });
}

function dbCount() {
  return db.prepare('SELECT COUNT(*) as cnt FROM draws').get().cnt;
}

function dbUpsert(draw) {
  db.prepare(`INSERT OR REPLACE INTO draws (draw, date, numbers, special, source) VALUES (?, ?, ?, ?, ?)`)
    .run(draw.draw, draw.date, JSON.stringify(draw.numbers), draw.special, draw.source || null);
}

function dbUpsertBatch(draws) {
  const tx = db.transaction((items) => {
    for (const d of items) dbUpsert(d);
  });
  tx(draws);
}

function dbMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function dbMetaSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

function fetchUrl(url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers
      }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && maxRedirects > 0) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = parsed.origin + redirectUrl;
        }
        res.resume();
        return fetchUrl(redirectUrl, options, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseLotteryExtreme(html) {
  const draws = [];
  const rowRegex = /<tr class='cy'><td class='cx'>(\d{2}\/\d{2}\/\d{4})\s+\w+\s+\((\d{2}\/\d{3})\)[\s\S]*?<\/tr>\s*<TR><TD class='c1'><ul class='displayball'[^>]*>([\s\S]*?)<\/ul>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const date = match[1];
    const draw = match[2];
    const ballsHtml = match[3];

    const parts = ballsHtml.split('<li class="dbx">');
    if (parts.length === 2) {
      const mainNos = [];
      const mainRegex = /<li>(\d{1,2})/g;
      let m;
      while ((m = mainRegex.exec(parts[0])) !== null) {
        mainNos.push(Number(m[1]));
      }

      let special = null;
      const specMatch = parts[1].match(/<li>(\d{1,2})/);
      if (specMatch) special = Number(specMatch[1]);

      if (mainNos.length === 6) {
        draws.push({ draw, date, numbers: mainNos, special, source: 'lotteryextreme' });
      }
    }
  }
  return draws;
}

function parseLotteryHk(html) {
  const draws = [];
  const rowRegex = /<tr>\s*<td>(\d{2}\/\d{3})<\/td>\s*<td><span class="date">(\d{2}\/\d{2}\/\d{4})<\/span><\/td>\s*<td>\s*<ul class="balls">([\s\S]*?)<\/ul>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const draw = match[1];
    const date = match[2];
    const ballsHtml = match[3];
    const ballRegex = /<li class="([^"]*)">(\d{1,2})<\/li>/g;
    const numbers = [];
    let special = null;
    let ballMatch;
    while ((ballMatch = ballRegex.exec(ballsHtml)) !== null) {
      if (ballMatch[1].includes('-plus')) {
        special = Number(ballMatch[2]);
      } else {
        numbers.push(Number(ballMatch[2]));
      }
    }
    if (numbers.length >= 6) {
      draws.push({ draw, date, numbers: numbers.slice(0, 6), special, source: 'lottery.hk' });
    }
  }
  return draws;
}

function parseGitHubData(data) {
  return data.map(d => ({
    draw: d.id,
    date: d.date ? d.date.split('-').reverse().join('/') : '',
    numbers: (d.no || []).map(Number),
    special: d.sno ? parseInt(d.sno) : null,
    source: 'github',
  }));
}

async function scrapeLotteryExtreme() {
  try {
    const { status, data: html } = await fetchUrl('https://www.lotteryextreme.com/marksix/results');
    if (status === 200) {
      const draws = parseLotteryExtreme(html);
      if (draws.length > 0) return draws;
    }
  } catch (e) {
    console.log('lotteryextreme.com failed:', e.message);
  }
  return [];
}

async function scrapeLotteryHk(years) {
  const results = [];
  for (const year of years) {
    try {
      const { status, data: html } = await fetchUrl(`https://lottery.hk/en/mark-six/results/${year}`);
      if (status === 200) {
        const draws = parseLotteryHk(html);
        if (draws.length > 0) {
          results.push(...draws);
          console.log(`  lottery.hk/${year}: ${draws.length} draws`);
        }
      }
    } catch (e) {
      console.log(`  lottery.hk/${year} failed:`, e.message);
    }
  }
  return results;
}

async function fetchGitHubData() {
  try {
    const { status, data } = await fetchUrl(
      'https://raw.githubusercontent.com/icelam/mark-six-data-visualization/master/data/all.json'
    );
    if (status === 200) return parseGitHubData(JSON.parse(data));
  } catch (e) {
    console.log('GitHub failed:', e.message);
  }
  return [];
}

async function refreshData() {
  const before = dbCount();
  console.log(`Refresh start: ${before} draws in DB`);

  // 1. lotteryextreme.com: latest 20
  try {
    const latest = await scrapeLotteryExtreme();
    if (latest.length > 0) {
      dbUpsertBatch(latest);
      console.log(`lotteryextreme.com: upserted ${latest.length} draws`);
    }
  } catch (e) {
    console.log('lotteryextreme.com failed:', e.message);
  }

  // 2. lottery.hk: fill missing years
  const currentYear = new Date().getFullYear();
  const existingYears = db.prepare(
    "SELECT DISTINCT substr(date, -4) as year FROM draws"
  ).all().map(r => r.year);
  const missingYears = [];
  for (let y = 1993; y <= currentYear; y++) {
    if (!existingYears.includes(String(y))) missingYears.push(y);
  }

  if (missingYears.length > 0) {
    console.log(`Scraping lottery.hk for ${missingYears.length} missing years...`);
    const hkDraws = await scrapeLotteryHk(missingYears);
    if (hkDraws.length > 0) {
      dbUpsertBatch(hkDraws);
    }
  } else {
    console.log('All years already in DB');
  }

  // 3. GitHub bulk if DB is small
  if (dbCount() < 100) {
    try {
      const ghDraws = await fetchGitHubData();
      if (ghDraws.length > 0) {
        dbUpsertBatch(ghDraws);
        console.log(`GitHub: upserted ${ghDraws.length} draws`);
      }
    } catch (e) {
      console.log('GitHub failed:', e.message);
    }
  }

  const after = dbCount();
  dbMetaSet('lastRefresh', new Date().toISOString());
  console.log(`Refresh done: ${before} -> ${after} draws (+${after - before} new)`);
  return after;
}

function toResponse(draws) {
  return draws.map(d => ({
    id: d.draw,
    year: d.date ? d.date.split('/').pop() : '',
    no: d.draw ? parseInt(d.draw.split('/')[1]) || 0 : 0,
    drawDate: d.date ? d.date.split('/').reverse().join('-') + '+08:00' : '',
    status: 'Result',
    drawResult: {
      drawnNo: typeof d.numbers === 'string' ? JSON.parse(d.numbers) : d.numbers,
      xDrawnNo: d.special,
    }
  }));
}

app.post('/api/marksix', (req, res) => {
  const { lastNDraw = 10 } = req.body;
  const total = dbCount();

  if (total > 0) {
    const draws = dbGetDraws(lastNDraw);
    console.log(`Serving ${draws.length} draws from DB (${total} total)`);
    return res.json({
      data: { lotteryDraws: toResponse(draws) },
      source: 'database',
      totalCached: total,
      lastRefresh: dbMeta('lastRefresh')
    });
  }

  res.json({
    data: { lotteryDraws: [] },
    source: 'empty',
    totalCached: 0,
    message: 'No data yet. Call POST /api/marksix/refresh first.'
  });
});

app.post('/api/marksix/refresh', async (req, res) => {
  try {
    await refreshData();
    const total = dbCount();
    const draws = dbGetDraws(req.body.lastNDraw || 10);
    return res.json({
      data: { lotteryDraws: toResponse(draws) },
      source: 'refreshed',
      totalCached: total,
      lastRefresh: dbMeta('lastRefresh')
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/marksix/history', (req, res) => {
  const { year, from, to, limit } = req.body;
  let draws;

  if (year) {
    draws = dbGetDrawsByYear(year);
  } else if (from || to) {
    draws = dbGetDrawsRange(from, to);
  } else {
    draws = dbGetDraws(limit || 50);
  }

  return res.json({
    data: { lotteryDraws: toResponse(draws) },
    source: 'database',
    totalCached: dbCount(),
    returned: draws.length
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDB();
console.log(`Database: ${DB_PATH}`);

app.listen(PORT, async () => {
  console.log(`Mark Six server running at http://localhost:${PORT}`);
  console.log(`DB has ${dbCount()} draws (last refresh: ${dbMeta('lastRefresh') || 'never'})`);

  if (dbCount() === 0) {
    console.log('DB empty, building initial history from GitHub...');
    try {
      const ghDraws = await fetchGitHubData();
      if (ghDraws.length > 0) {
        dbUpsertBatch(ghDraws);
        dbMetaSet('lastRefresh', new Date().toISOString());
        console.log(`Initial build: ${ghDraws.length} draws loaded`);
      }
    } catch (e) {
      console.log('Initial build failed:', e.message);
    }
  }
});
