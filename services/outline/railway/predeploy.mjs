// Outline pre-deploy step for Railway (runs before every deploy of the web service).
//
// 1. Waits for Postgres and Redis (they start in parallel and may take minutes).
// 2. Sets the Railway Bucket's CORS rule so browsers can upload with presigned URLs.
// 3. On a fresh database: starts Outline on a private port inside this pre-deploy
//    container, creates the workspace and the first admin through Outline's own
//    installation API, and stops it again. Outline's setup endpoint is open to
//    anyone while no workspace exists, so it must be used before the public
//    deployment serves (STANDARD 8.37). This container gets no public traffic.
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';

const APP = '/opt/outline';
const require = createRequire(`${APP}/package.json`);
const env = process.env;
const log = msg => console.log(`[railway] ${msg}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BOOT_PORT = '3999';

function tcpReady(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port, timeout: 3000 });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(name, url, defaultPort, limitMs) {
  let target;
  try {
    target = new URL(url);
  } catch {
    log(`WARNING: ${name} URL is not valid; not waiting for it`);
    return false;
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const port = Number(target.port || defaultPort);
  const end = Date.now() + limitMs;
  for (let i = 0; Date.now() < end; i++) {
    if (await tcpReady(host, port)) {
      log(`${name} reachable`);
      return true;
    }
    if (i % 6 === 0) log(`waiting for ${name} (${host}:${port})...`);
    await sleep(5000);
  }
  log(`ERROR: ${name} not reachable after ${limitMs / 1000} s`);
  return false;
}

// ---------- Bucket CORS (S3 PutBucketCors, SigV4, no SDK) ----------
async function bucketCors() {
  if ((env.FILE_STORAGE || '').toLowerCase() !== 's3') return;
  if (/^(0|false|no|off)$/i.test(env.BUCKET_CORS_ENABLED || 'true')) {
    log('bucket CORS: skipped (BUCKET_CORS_ENABLED=false)');
    return;
  }
  const bucket = env.AWS_S3_UPLOAD_BUCKET_NAME;
  const endpointUrl = env.AWS_S3_UPLOAD_BUCKET_URL;
  const keyId = env.AWS_ACCESS_KEY_ID;
  const secret = env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !endpointUrl || !keyId || !secret) {
    log('bucket CORS: skipped (bucket variables not set)');
    return;
  }
  let origins = (env.BUCKET_CORS_ORIGINS || '').split(/[\s,]+/).filter(Boolean);
  if (!origins.length) {
    try {
      origins = [new URL(env.URL).origin];
    } catch {
      origins = ['*'];
    }
  }
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><CORSRule>' +
    origins.map(o => `<AllowedOrigin>${o}</AllowedOrigin>`).join('') +
    '<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>' +
    '<AllowedMethod>PUT</AllowedMethod><AllowedMethod>POST</AllowedMethod>' +
    '<AllowedHeader>*</AllowedHeader>' +
    '<ExposeHeader>ETag</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader>' +
    '<ExposeHeader>Content-Type</ExposeHeader>' +
    '<MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>';
  let endpoint;
  try {
    endpoint = new URL(endpointUrl);
  } catch {
    log('bucket CORS: skipped (AWS_S3_UPLOAD_BUCKET_URL is not a URL)');
    return;
  }
  const pathStyle = /^(1|true|yes|on)$/i.test(env.AWS_S3_FORCE_PATH_STYLE || '');
  const host = pathStyle ? endpoint.host : `${bucket}.${endpoint.host}`;
  const path = pathStyle ? `/${bucket}` : '/';
  const region = env.AWS_REGION || 'auto';
  const sha256 = data => createHash('sha256').update(data).digest('hex');
  const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = {
    'content-md5': createHash('md5').update(body).digest('base64'),
    'content-type': 'application/xml',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = ['PUT', path, 'cors=', names.map(k => `${k}:${headers[k]}\n`).join(''), signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let key = hmac(`AWS4${secret}`, day);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _omit, ...sendHeaders } = headers;
  try {
    const res = await fetch(`${endpoint.protocol}//${host}${path}?cors=`, {
      method: 'PUT',
      headers: {
        ...sendHeaders,
        authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) log(`bucket CORS: rule applied (origins: ${origins.join(', ')})`);
    else log(`bucket CORS: WARNING: PutBucketCors answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    log(`bucket CORS: WARNING: request failed: ${err.message}`);
  }
}

// ---------- first workspace + admin ----------
function adminValues() {
  let host = 'localhost';
  try {
    host = new URL(env.URL).hostname;
  } catch {
    log(`WARNING: URL '${env.URL}' is not a URL`);
  }
  let email = (env.OUTLINE_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    log(`WARNING: OUTLINE_ADMIN_EMAIL '${email}' is not an e-mail address; using admin@${host}`);
    email = `admin@${host}`;
  }
  const clean = (value, fallback) => {
    const text = (value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
    return text || fallback;
  };
  return {
    userEmail: email,
    userName: clean(env.OUTLINE_ADMIN_NAME, 'Admin'),
    teamName: clean(env.OUTLINE_WORKSPACE_NAME, 'Outline'),
  };
}

async function teamCount() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT to_regclass('public.teams') IS NOT NULL AS present");
    if (!rows[0].present) return 0;
    const result = await client.query('SELECT count(*)::int AS n FROM teams');
    return result.rows[0].n;
  } finally {
    await client.end();
  }
}

function postLocal(path, payload) {
  let host = 'localhost';
  try {
    host = new URL(env.URL).host;
  } catch { /* keep localhost */ }
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: Number(BOOT_PORT),
      path,
      method: 'POST',
      timeout: 60000,
      headers: {
        host,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-forwarded-proto': 'https',
        'x-forwarded-host': host,
      },
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function bootstrapWorkspace() {
  const existing = await teamCount();
  if (existing > 0) {
    log(`workspace already exists (${existing}); nothing to create`);
    return true;
  }
  const values = adminValues();
  log(`fresh database: starting Outline on private port ${BOOT_PORT} to create the workspace (runs migrations)`);
  const child = spawn('node', ['build/server/index.js'], {
    cwd: APP,
    env: { ...env, PORT: BOOT_PORT, SERVICES: 'web', WEB_CONCURRENCY: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  let exited = false;
  child.once('exit', code => {
    exited = true;
    log(`temporary Outline exited (${code})`);
  });
  const stop = async () => {
    if (exited) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 30 && !exited; i++) await sleep(1000);
    if (!exited) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  };
  try {
    const base = `http://127.0.0.1:${BOOT_PORT}`;
    const end = Date.now() + 15 * 60 * 1000;
    let healthy = false;
    while (!exited && Date.now() < end) {
      try {
        const res = await fetch(`${base}/_health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok && (await res.text()).includes('OK')) { healthy = true; break; }
      } catch { /* not up yet */ }
      await sleep(3000);
    }
    if (!healthy) {
      log('ERROR: the temporary Outline did not become healthy');
      return false;
    }
    // Outline redirects requests whose Host is not URL's host; send the public
    // host and scheme so the request is handled here and not redirected.
    const res = await postLocal('/api/installation.create', values);
    const text = res.body;
    if (res.status === 200) {
      log(`workspace '${values.teamName}' created; admin ${values.userEmail}`);
      return true;
    }
    if (/existing teams/i.test(text)) {
      log('workspace already exists; nothing to create');
      return true;
    }
    log(`ERROR: installation.create answered ${res.status}${res.location ? ` (redirect to ${res.location})` : ''}: ${text.slice(0, 300)}`);
    return false;
  } finally {
    await stop();
  }
}

const dbOk = await waitFor('Postgres', env.DATABASE_URL, 5432, 15 * 60 * 1000);
const redisOk = await waitFor('Redis', env.REDIS_URL, 6379, 15 * 60 * 1000);
if (!dbOk || !redisOk) process.exit(1);
await bucketCors();
let ok = false;
try {
  ok = await bootstrapWorkspace();
} catch (err) {
  log(`ERROR: workspace bootstrap failed: ${err.message}`);
}
process.exit(ok ? 0 : 1);
