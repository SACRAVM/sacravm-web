// ═══════════════════════════════════════════════════════════════════
//  SACRAVM — servidor local
//  ─────────────────────────────────────────────────────────────────
//  Qué hace:
//   1. Sirve tu web pública (index.html) en http://localhost:3000
//   2. Sirve tu panel de administración en http://localhost:3000/admin
//      (como WordPress: entras con tu usuario y contraseña y cambias
//      todo desde ahí — sin tocar código)
//   3. Cada reserva o lead se guarda en leads/leads.csv
//   4. Todo el contenido editable vive en content.json
//
//  No necesitas instalar nada (no usa librerías externas).
//  Para arrancarlo: doble clic en START.command
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// DATA_DIR: en tu ordenador, igual que la carpeta de la web (ROOT).
// En un hosting con disco persistente (ej. Render), se configura la
// variable de entorno DATA_DIR apuntando al disco, para que tus leads,
// tu contenido y tu contraseña sobrevivan a los reinicios del servidor.
const DATA_DIR = process.env.DATA_DIR || ROOT;
const LEADS_DIR = path.join(DATA_DIR, 'leads');
const LEADS_FILE = path.join(LEADS_DIR, 'leads.csv');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LEAD_REFS_DIR = path.join(LEADS_DIR, 'referencias');

const SESSION_COOKIE = 'sacravm_session';
const sessions = new Map(); // token -> { username, created }

// ── Utilidades de archivos ─────────────────────────────────────────
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function ensureDirs() {
  if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(LEAD_REFS_DIR)) fs.mkdirSync(LEAD_REFS_DIR, { recursive: true });
  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, 'fecha_registro,tipo,nombre,email,whatsapp,servicio,fecha_cita,hora_cita,mensaje,instagram,zona,tamano,bebida,ya_tatuado,fuente,referencias\n', 'utf8');
  }
  if (!fs.existsSync(CONTENT_FILE)) {
    writeJSON(CONTENT_FILE, DEFAULT_CONTENT);
  }
}

const DEFAULT_CONTENT = {
  nombre: 'JJ Rodríguez',
  ciudad: 'León',
  email: 'hola@sacravm.com',
  whatsapp: '+34 XXX XXX XXX',
  bizum: '+34 XXX XXX XXX',
  instagram: 'sacravm',
  horarios: ['10:00', '12:00', '16:00', '18:00'],
  diasMaxReserva: 45,
  fotos: {
    hero: '/images/hero/hero.jpg', perfil: '/images/hero/perfil.jpg',
    tt1: { url: '/images/portfolio/tt1.jpg', estilo: 'Micro-realismo', desc: 'Retrato' },
    tt2: { url: '/images/portfolio/tt2.jpg', estilo: 'Fine line', desc: 'Botánico' },
    tt3: { url: '/images/portfolio/tt3.jpg', estilo: 'Realismo conceptual', desc: 'Composición' },
    tt4: { url: '/images/portfolio/tt4.jpg', estilo: 'Fine line', desc: 'Lettering' },
    tt5: { url: '/images/portfolio/tt5.jpg', estilo: 'Micro-realismo', desc: 'Detalle' },
    tt6: { url: '/images/portfolio/tt6.jpg', estilo: 'Realismo conceptual', desc: 'Narrativo' },
  },
  servicios: [
    { nombre: 'Micro-realismo', descripcion: 'Piezas pequeñas y medias con lectura limpia, profundidad visual y detalle fino pensado para durar bien en piel.', ideal: 'Retratos, símbolos delicados, composiciones precisas.', precio: '150–500€' },
    { nombre: 'Realismo conceptual', descripcion: 'Diseños con carga simbólica, composición estética y narrativa visual construida contigo desde la idea.', ideal: 'Proyectos con significado personal, composiciones únicas.', precio: '250–500€' },
    { nombre: 'Fine line', descripcion: 'Línea fina, limpia y elegante para quienes buscan sutileza, gusto y una estética menos obvia.', ideal: 'Lettering delicado, botánicos, ornamentos sutiles.', precio: '60–300€' },
  ],
  testimonios: [
    { txt: 'No sentí que estuviera entrando a un estudio más, sino a un sitio preparado para escuchar bien la idea y llevarla a un resultado fino y con criterio.', by: 'Claudia M.' },
    { txt: 'La reserva fue clara, la sesión estuvo muy cuidada y todo el proceso se notó pensado para que el tatuaje saliera como tenía que salir.', by: 'Javier R.' },
    { txt: 'Se agradece que no haya prisas ni ruido. JJ se toma el tiempo de entender la idea y eso cambia completamente el resultado.', by: 'Lucía P.' },
  ],
  cuadros: [
    { url: '', nombre: 'Pieza I', meta: 'Óleo sobre lienzo · 60×80cm' },
    { url: '', nombre: 'Pieza II', meta: 'Técnica mixta · 50×70cm' },
    { url: '', nombre: 'Pieza III', meta: 'Acrílico sobre lienzo · 40×50cm' },
  ],
  galeria: [
    { url: '/images/galeria/g1.jpg', estilo: 'FINE LINE', desc: 'Composición vertical' },
    { url: '/images/galeria/g2.jpg', estilo: 'MICRO-REALISMO', desc: 'Detalle' },
    { url: '/images/galeria/g3.jpg', estilo: 'REALISMO CONCEPTUAL', desc: 'Composición' },
    { url: '/images/galeria/g4.jpg', estilo: 'REALISMO', desc: 'Proyecto de brazo' },
    { url: '/images/galeria/g5.jpg', estilo: 'MICRO-REALISMO', desc: 'Retrato' },
    { url: '/images/galeria/g6.jpg', estilo: 'REALISMO CONCEPTUAL', desc: 'Composición · Manga' },
    { url: '/images/galeria/g7.jpg', estilo: 'FINE LINE', desc: 'Botánico' },
    { url: '/images/galeria/g8.jpg', estilo: 'SACRAVM', desc: 'En sesión' },
  ],
  textos: {
    valeRegaloTitulo: 'Regala algo único.\nY para siempre.',
    valeRegaloTexto: 'Unas flores se marchitan. Una cena se olvida. Un tatuaje de SACRAVM se queda para siempre — y lleva tu gesto dentro. Elige un importe, yo me encargo del resto.',
    inversionTitulo: 'Cada formato, pensado para que el resultado esté a la altura',
    inversionTexto: 'El diseño se prepara en exclusiva el día de tu cita. La señal confirma tu plaza y se descuenta del total — el resto se abona al cerrar la sesión.',
    academyTitulo: 'Domina el oficio con quien ya se lo juega en piel real.',
    academyTexto: 'Un programa online de 3-6 meses para tatuadores que no quieren aprender por prueba y error. Técnica, criterio, marca personal y captación de clientes.',
  },
};

// ── CSV (leads) ─────────────────────────────────────────────────────
function csvEscape(val) {
  const s = (val === undefined || val === null) ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function appendLead(data, referenciasPaths) {
  ensureDirs();
  const row = [
    new Date().toLocaleString('es-ES'), data.tipo || '', data.nombre || '', data.email || '',
    data.whatsapp || '', data.servicio || '', data.fecha || '', data.hora || '', data.mensaje || '', data.instagram || '',
    data.zona || '', data.tamano || '', data.bebida || '', data.ya_tatuado || '', data.fuente || '',
    (referenciasPaths || []).join(';')
  ].map(csvEscape).join(',');
  fs.appendFileSync(LEADS_FILE, row + '\n', 'utf8');
}
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function readLeads() {
  ensureDirs();
  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).reverse().map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
}

// ── Contraseñas (hash con scrypt + sal, sin librerías externas) ────
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// ── Cookies / sesiones ───────────────────────────────────────────────
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}
function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  return token && sessions.has(token) ? sessions.get(token) : null;
}
function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, created: Date.now() });
  return token;
}

// ── Body JSON ────────────────────────────────────────────────────────
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let chunks = []; let size = 0;
    req.on('data', d => {
      size += d.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('payload demasiado grande')); return; }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sendJSON(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}));
  res.end(JSON.stringify(obj));
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };

const server = http.createServer(async (req, res) => {
  ensureDirs();
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    // ═══ API pública ═══
    if (pathname === '/api/content' && req.method === 'GET') {
      return sendJSON(res, 200, readJSON(CONTENT_FILE, DEFAULT_CONTENT));
    }
    if (pathname === '/api/lead' && req.method === 'POST') {
      const body = await readBody(req, 15e6);
      const data = JSON.parse(body || '{}');
      const refs = Array.isArray(data.referencias) ? data.referencias.slice(0, 6) : [];
      const referenciasPaths = refs.map((dataUrl, i) => {
        try {
          const base64Data = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
          const buf = Buffer.from(base64Data, 'base64');
          if (buf.length > 4e6) return null; // descarta imágenes individuales excesivas
          const outName = 'ref_' + Date.now() + '_' + i + '.jpg';
          fs.writeFileSync(path.join(LEAD_REFS_DIR, outName), buf);
          return 'leads/referencias/' + outName;
        } catch (e) { return null; }
      }).filter(Boolean);
      appendLead(data, referenciasPaths);
      console.log('✓ Nuevo lead:', data.tipo, '-', data.nombre || data.email, referenciasPaths.length ? `(${referenciasPaths.length} refs)` : '');
      return sendJSON(res, 200, { ok: true }, { 'Access-Control-Allow-Origin': '*' });
    }

    // ═══ Estado de la cuenta / sesión ═══
    if (pathname === '/api/auth-status' && req.method === 'GET') {
      const hasAccount = fs.existsSync(CREDENTIALS_FILE);
      const session = getSession(req);
      return sendJSON(res, 200, { hasAccount, loggedIn: !!session, username: session ? session.username : null });
    }

    // ═══ Crear cuenta (solo si no existe ninguna) ═══
    if (pathname === '/api/setup' && req.method === 'POST') {
      if (fs.existsSync(CREDENTIALS_FILE)) return sendJSON(res, 400, { ok: false, error: 'Ya existe una cuenta.' });
      const body = JSON.parse(await readBody(req, 1e5) || '{}');
      const username = (body.username || '').trim();
      const password = body.password || '';
      if (!username || password.length < 6) return sendJSON(res, 400, { ok: false, error: 'Usuario y contraseña (mín. 6 caracteres) son obligatorios.' });
      const { salt, hash } = hashPassword(password);
      writeJSON(CREDENTIALS_FILE, { username, salt, hash });
      const token = createSession(username);
      return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=2592000` });
    }

    // ═══ Login ═══
    if (pathname === '/api/login' && req.method === 'POST') {
      const creds = readJSON(CREDENTIALS_FILE, null);
      if (!creds) return sendJSON(res, 400, { ok: false, error: 'Todavía no hay ninguna cuenta creada.' });
      const body = JSON.parse(await readBody(req, 1e5) || '{}');
      const username = (body.username || '').trim();
      const password = body.password || '';
      if (username !== creds.username || !verifyPassword(password, creds.salt, creds.hash)) {
        return sendJSON(res, 401, { ok: false, error: 'Usuario o contraseña incorrectos.' });
      }
      const token = createSession(username);
      return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=2592000` });
    }

    // ═══ Logout ═══
    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) sessions.delete(token);
      return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0` });
    }

    // ═══ A partir de aquí, todo requiere sesión iniciada ═══
    const protectedRoutes = ['/api/content', '/api/upload-photo', '/api/change-password', '/api/leads'];
    const isProtectedWrite = (pathname === '/api/content' && req.method === 'POST') ||
      pathname === '/api/upload-photo' || pathname === '/api/change-password' ||
      (pathname === '/api/leads' && req.method === 'GET');

    if (isProtectedWrite && !getSession(req)) {
      return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
    }

    if (pathname === '/api/leads' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, leads: readLeads() });
    }

    if (pathname === '/api/content' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 2e6) || '{}');
      writeJSON(CONTENT_FILE, body);
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/upload-photo' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 12e6) || '{}');
      const { slot, listKey, index, filename, dataBase64 } = body;
      if ((!slot && !listKey) || !dataBase64) return sendJSON(res, 400, { ok: false, error: 'Faltan datos.' });
      const ext = (path.extname(filename || '') || '.jpg').toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const outName = 'foto_' + (slot || listKey + '_' + index) + '_' + Date.now() + safeExt;
      const outPath = path.join(UPLOADS_DIR, outName);
      const base64Data = dataBase64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
      const content = readJSON(CONTENT_FILE, DEFAULT_CONTENT);
      const publicPath = '/uploads/' + outName;
      if (slot) {
        if (slot === 'hero' || slot === 'perfil') {
          content.fotos[slot] = publicPath;
        } else {
          content.fotos[slot] = content.fotos[slot] || {};
          content.fotos[slot].url = publicPath;
        }
      } else if (listKey) {
        content[listKey] = content[listKey] || [];
        content[listKey][index] = content[listKey][index] || {};
        content[listKey][index].url = publicPath;
      }
      writeJSON(CONTENT_FILE, content);
      return sendJSON(res, 200, { ok: true, path: publicPath });
    }

    if (pathname === '/api/change-password' && req.method === 'POST') {
      const creds = readJSON(CREDENTIALS_FILE, null);
      const body = JSON.parse(await readBody(req, 1e5) || '{}');
      const { currentPassword, newPassword } = body;
      if (!creds || !verifyPassword(currentPassword || '', creds.salt, creds.hash)) {
        return sendJSON(res, 401, { ok: false, error: 'Contraseña actual incorrecta.' });
      }
      if (!newPassword || newPassword.length < 6) return sendJSON(res, 400, { ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      const { salt, hash } = hashPassword(newPassword);
      writeJSON(CREDENTIALS_FILE, { username: creds.username, salt, hash });
      return sendJSON(res, 200, { ok: true });
    }

    // ═══ Fotos subidas (viven en el disco persistente / DATA_DIR) ═══
    if (pathname.startsWith('/uploads/')) {
      const fileName = decodeURIComponent(pathname.replace('/uploads/', ''));
      const uploadPath = path.join(UPLOADS_DIR, fileName);
      if (!uploadPath.startsWith(UPLOADS_DIR)) { res.writeHead(403); res.end('Prohibido'); return; }
      return fs.readFile(uploadPath, (err, content) => {
        if (err) { res.writeHead(404); res.end('404 — No encontrado'); return; }
        const ext = path.extname(uploadPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
      });
    }

    // ═══ Archivos estáticos (código de la web, siempre en ROOT) ═══
    let filePath = pathname;
    if (filePath === '/') filePath = '/index.html';
    if (filePath === '/admin') filePath = '/admin.html';
    filePath = path.join(ROOT, decodeURIComponent(filePath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Prohibido'); return; }

    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 — No encontrado'); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': (MIME[ext] || 'application/octet-stream') + (ext === '.html' ? '; charset=utf-8' : '') });
      res.end(content);
    });

  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { ok: false, error: 'Error interno: ' + e.message });
  }
});

ensureDirs();
server.listen(PORT, () => {
  console.log('');
  console.log('  ✦ SACRAVM está en marcha');
  console.log('  → Tu web:            http://localhost:' + PORT);
  console.log('  → Panel de edición:  http://localhost:' + PORT + '/admin');
  console.log('  → Tus leads:         leads/leads.csv');
  console.log('  → Para parar: cierra esta ventana o pulsa Ctrl+C');
  console.log('');
});
