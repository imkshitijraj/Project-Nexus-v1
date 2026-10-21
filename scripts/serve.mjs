import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.json':'application/json' };
const publicFiles=new Set(['index.html','appearance.js','auth-ui.js','account-ui.js','account.css','app.js','model.js','management.js','connection.js','runtime-config.js','styles.css','assets/mark.svg','assets/pdf-lib.js']);
const server = http.createServer(async (req,res) => {
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const full = path.resolve(root,relative);
    if (!publicFiles.has(relative)) {res.writeHead(404);res.end('Not found');return;}
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type':mime[path.extname(full)], 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' }); res.end(req.method==='HEAD'?undefined:data);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.STATIC_PORT??4173),'127.0.0.1',()=>console.log(`Project Nexus: http://127.0.0.1:${server.address().port}`));
