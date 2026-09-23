// Run SQL via the temporary run-sql edge fn (CLI db push blocked).
const secret = process.env.CRON_SECRET || '0mvixrnd7zl3ckow92us645jbhqet8yf1gap';
const sql = process.argv[2] || require('fs').readFileSync(process.argv[2] || '', 'utf8');

const sqlText = process.argv[2] && require('fs').existsSync(process.argv[2])
  ? require('fs').readFileSync(process.argv[2], 'utf8')
  : process.argv[3];

if (!sqlText) {
  console.error('usage: node scripts/run-sql.cjs <file.sql>  OR  node scripts/run-sql.cjs -- - << not supported; pass file path');
  process.exit(1);
}

(async () => {
  try {
    const r = await fetch('https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/run-sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ sql: sqlText }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
    process.exit(j.ok ? 0 : 1);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
