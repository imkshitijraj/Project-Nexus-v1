// Explicit local demonstration. Never connects to a configured production database
// or email account, and never reads .env. Accounts persist in their own directory.
import path from 'node:path';
Object.assign(process.env,{
  NODE_ENV:'development',DEMO_SEED:'1',DATABASE_URL:'',
  DATA_DIR:path.resolve(import.meta.dirname,'../.data/account-demo'),
  HOST:'127.0.0.1',PORT:'4174',PUBLIC_URL:'http://127.0.0.1:4174',
  ALLOWED_ORIGINS:'http://127.0.0.1:4174,http://localhost:4174',
  SMTP_URL:'',MAIL_FROM:'',TRUST_PROXY:'0',CROSS_SITE_COOKIES:'0',
});
// Rotate access-token signing per run; valid refresh cookies can restore sessions.
delete process.env.JWT_SECRET;
await import('../server/index.ts');
