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
const https = require('https');
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
const LEADS_HEADER = ['fecha_registro','tipo','nombre','email','whatsapp','servicio','fecha_cita','hora_cita','mensaje','instagram','zona','tamano','bebida','ya_tatuado','fuente','tier','fianza','referencias','estado_fianza','recordatorio_enviado','seguimiento_enviado'];

function ensureDirs() {
  if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(LEAD_REFS_DIR)) fs.mkdirSync(LEAD_REFS_DIR, { recursive: true });
  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, LEADS_HEADER.join(',') + '\n', 'utf8');
  } else {
    migrateLeadsSchema();
  }
  if (!fs.existsSync(CONTENT_FILE)) {
    writeJSON(CONTENT_FILE, DEFAULT_CONTENT);
  }
}
// Si leads.csv es de una versión anterior (le faltan columnas nuevas como
// tier, fianza, estado_fianza...), lo reescribe añadiendo esas columnas
// vacías al principio, sin tocar ni perder ningún dato ya guardado.
function migrateLeadsSchema() {
  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n').filter(l => l.trim().length);
  if (!lines.length) return;
  const currentHeader = parseCsvLine(lines[0]);
  const missing = LEADS_HEADER.filter(h => !currentHeader.includes(h));
  if (!missing.length) return;
  const rows = lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    currentHeader.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
  writeLeadsRaw(LEADS_HEADER, rows);
  console.log('✓ leads.csv actualizado con las columnas nuevas:', missing.join(', '));
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
  diasMinReserva: 3,
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
    { url: '', nombre: 'Pieza I', meta: 'Bic sobre papel' },
    { url: '', nombre: 'Pieza II', meta: 'Bic sobre papel' },
    { url: '', nombre: 'Pieza III', meta: 'Bic sobre papel' },
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
  experiencesVideoUrl: '',
  experiencesFotos: [],
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
    data.tier || '', data.fianza || '',
    (referenciasPaths || []).join(';'),
    data.estado_fianza === 'pagada' ? 'pagada' : '', // se puede marcar ya cobrada al crear la ficha manual
    '', '' // recordatorio_enviado, seguimiento_enviado — los rellena el planificador de emails
  ].map(csvEscape).join(',');
  fs.appendFileSync(LEADS_FILE, row + '\n', 'utf8');
}
// Devuelve las filas crudas (sin invertir), con su índice real de fila — para poder editar una en concreto
function readLeadsRaw() {
  ensureDirs();
  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n').filter(l => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, i) => {
    const vals = parseCsvLine(line);
    const obj = { _row: i };
    headers.forEach((h, j) => obj[h] = vals[j] || '');
    return obj;
  });
  return { headers, rows };
}
function writeLeadsRaw(headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(',')));
  fs.writeFileSync(LEADS_FILE, lines.join('\n') + '\n', 'utf8');
}
function setLeadEstadoFianza(rowIndex, estado) {
  return updateLeadFields(rowIndex, { estado_fianza: estado });
}
// Actualiza uno o varios campos de un lead concreto (identificado por su
// número de fila). Solo toca los campos que existan como columna real —
// ignora cualquier otra clave por seguridad.
function updateLeadFields(rowIndex, fields) {
  const { headers, rows } = readLeadsRaw();
  const row = rows.find(r => r._row === rowIndex);
  if (!row) return false;
  Object.keys(fields).forEach(k => {
    if (headers.includes(k)) row[k] = fields[k] == null ? '' : String(fields[k]);
  });
  writeLeadsRaw(headers, rows);
  return true;
}
// Fechas/horas ya reservadas (para pintar el calendario público en verde/rojo)
function readOcupados() {
  const { rows } = readLeadsRaw();
  return rows
    .filter(r => r.tipo === 'reserva' && r.fecha_cita)
    .map(r => ({ fecha: r.fecha_cita, hora: r.hora_cita }));
}

// ── EMAILS AUTOMÁTICOS (confirmación, recordatorio, seguimiento) ────
// Usa Resend (https://resend.com) por su API HTTP simple — sin librerías.
// Configura RESEND_API_KEY (obligatoria) y opcionalmente RESEND_FROM
// como variables de entorno en Render. Sin la API key, los emails se
// omiten silenciosamente (no rompe nada, solo no se envían).
function sendEmail(to, subject, html) {
  return new Promise((resolve) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || !to) { resolve({ ok: false, skipped: true }); return; }
    const from = process.env.RESEND_FROM || 'SACRAVM <onboarding@resend.dev>';
    const payload = JSON.stringify({ from, to: [to], subject, html });
    const reqOpts = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const httpReq = https.request(reqOpts, (httpRes) => {
      let body = '';
      httpRes.on('data', (c) => body += c);
      httpRes.on('end', () => resolve({ ok: httpRes.statusCode < 300, status: httpRes.statusCode, body }));
    });
    httpReq.on('error', (e) => resolve({ ok: false, error: e.message }));
    httpReq.write(payload);
    httpReq.end();
  });
}

function fmtFechaEs(fechaISO) {
  if (!fechaISO) return '';
  const [y, m, d] = fechaISO.split('-');
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1]} de ${y}`;
}

const EMAIL_WRAP = (body) => `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;color:#1C1714;line-height:1.7">
    <div style="font-size:22px;letter-spacing:.1em;margin-bottom:24px">SACR<em style="color:#8B5E2A;font-style:italic">AVM</em></div>
    ${body}
    <p style="margin-top:32px;font-size:13px;color:#6B6460">JJ Rodríguez · SACRAVM · León</p>
  </div>`;

function emailConfirmacion(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `Tu cita en SACRAVM — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Tu cita ha quedado reservada:</p>
      <p><strong>Fecha:</strong> ${fecha}<br><strong>Hora:</strong> ${lead.hora_cita || ''}<br><strong>Servicio:</strong> ${lead.servicio || ''}</p>
      <p>Para dejarla confirmada del todo, recuerda completar el pago de la fianza por Bizum si aún no lo has hecho.</p>
      <p>Unos días antes te escribo con todo lo que conviene saber antes de la sesión.</p>
      <p>Cualquier duda, escríbeme sin problema.</p>
    `),
  };
}

function emailRecordatorio(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `Tu cita es en 2 días — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Te escribo porque tu cita es en dos días, el <strong>${fecha}${lead.hora_cita ? ' a las ' + lead.hora_cita : ''}</strong>.</p>
      <p>Antes de venir, unas recomendaciones para que la sesión vaya lo mejor posible:</p>
      <ul>
        <li>Duerme bien la noche anterior</li>
        <li>Come antes de venir — nada de ayunas</li>
        <li>Evita el alcohol en las 24h anteriores</li>
        <li>Hidrata bien la zona a tatuar los días previos</li>
        <li>Viste algo cómodo que deje acceso fácil a la zona</li>
      </ul>
      <p>Nos vemos pronto.</p>
    `),
  };
}

function emailSeguimiento(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  return {
    subject: `¿Qué tal va tu tatuaje?`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Ha pasado una semana desde tu sesión — espero que la curación esté yendo bien.</p>
      <p>Un par de recordatorios rápidos:</p>
      <ul>
        <li>Sigue hidratando la zona con la crema que te indiqué</li>
        <li>Evita el sol directo mientras cure</li>
        <li>Nada de piscina, playa o baños largos hasta que esté cerrado del todo</li>
      </ul>
      <p>Si ves algo que no te convence o tienes cualquier duda, escríbeme y lo vemos. Y si te apetece, me encantaría ver una foto de cómo ha quedado una vez curado.</p>
      <p>¡Gracias por confiar en SACRAVM!</p>
    `),
  };
}

// Comprueba citas para las que toca mandar recordatorio (2 días antes) o
// seguimiento (7 días después), y las envía una sola vez por cita.
async function runEmailScheduler() {
  try {
    const { headers, rows } = readLeadsRaw();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const in2days = new Date(today); in2days.setDate(in2days.getDate() + 2);
    const ago7days = new Date(today); ago7days.setDate(ago7days.getDate() - 7);
    const in2Str = fmt(in2days), ago7Str = fmt(ago7days);
    let changed = false;
    for (const row of rows) {
      if (row.tipo !== 'reserva' || !row.fecha_cita || !row.email) continue;
      if (row.fecha_cita === in2Str && row.recordatorio_enviado !== 'si') {
        const { subject, html } = emailRecordatorio(row);
        const r = await sendEmail(row.email, subject, html);
        if (r.ok) { row.recordatorio_enviado = 'si'; changed = true; }
      }
      if (row.fecha_cita === ago7Str && row.seguimiento_enviado !== 'si') {
        const { subject, html } = emailSeguimiento(row);
        const r = await sendEmail(row.email, subject, html);
        if (r.ok) { row.seguimiento_enviado = 'si'; changed = true; }
      }
    }
    if (changed) writeLeadsRaw(headers, rows);
  } catch (e) { console.error('Error en el planificador de emails:', e.message); }
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
  const { rows } = readLeadsRaw();
  return rows.slice().reverse();
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
      sendJSON(res, 200, { ok: true }, { 'Access-Control-Allow-Origin': '*' });
      // Email de confirmación — no bloquea la respuesta al cliente
      if (data.tipo === 'reserva' && data.email) {
        const { subject, html } = emailConfirmacion({ nombre: data.nombre, fecha_cita: data.fecha, hora_cita: data.hora, servicio: data.servicio });
        sendEmail(data.email, subject, html).catch(() => {});
      }
      return;
    }
    // Fechas/horas ya reservadas — para pintar el calendario de citas en verde/rojo
    if (pathname === '/api/ocupados' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, ocupados: readOcupados() });
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
    const protectedRoutes = ['/api/content', '/api/upload-photo', '/api/change-password', '/api/leads', '/api/lead-status', '/api/lead-edit'];
    const isProtectedWrite = (pathname === '/api/content' && req.method === 'POST') ||
      pathname === '/api/upload-photo' || pathname === '/api/change-password' ||
      (pathname === '/api/leads' && req.method === 'GET') ||
      (pathname === '/api/lead-status' && req.method === 'POST') ||
      (pathname === '/api/lead-edit' && req.method === 'POST');

    if (isProtectedWrite && !getSession(req)) {
      return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
    }

    if (pathname === '/api/leads' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, leads: readLeads() });
    }

    if (pathname === '/api/lead-status' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 1e4) || '{}');
      const rowIndex = Number(body.rowIndex);
      const estado = body.estado === 'pagada' ? 'pagada' : '';
      if (Number.isNaN(rowIndex)) return sendJSON(res, 400, { ok: false, error: 'Falta rowIndex.' });
      const ok = setLeadEstadoFianza(rowIndex, estado);
      return sendJSON(res, ok ? 200 : 404, { ok });
    }

    if (pathname === '/api/lead-edit' && req.method === 'POST') {
      const EDITABLE_LEAD_FIELDS = ['nombre', 'email', 'whatsapp', 'servicio', 'fecha_cita', 'hora_cita', 'mensaje', 'zona', 'tamano', 'bebida', 'ya_tatuado', 'fuente'];
      const body = JSON.parse(await readBody(req, 2e5) || '{}');
      const rowIndex = Number(body.rowIndex);
      if (Number.isNaN(rowIndex)) return sendJSON(res, 400, { ok: false, error: 'Falta rowIndex.' });
      const fields = {};
      EDITABLE_LEAD_FIELDS.forEach(k => { if (Object.prototype.hasOwnProperty.call(body.fields || {}, k)) fields[k] = body.fields[k]; });
      const ok = updateLeadFields(rowIndex, fields);
      return sendJSON(res, ok ? 200 : 404, { ok });
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
  if (!process.env.RESEND_API_KEY) {
    console.log('  ⚠ RESEND_API_KEY no configurada — los emails automáticos están desactivados.');
  }
  console.log('');
});

// Planificador de emails: recordatorio (2 días antes) y seguimiento (7 días
// después). Se comprueba al arrancar y luego cada hora — de sobra para no
// perder el día exacto, incluso si el servicio se reinicia en Render.
runEmailScheduler();
setInterval(runEmailScheduler, 60 * 60 * 1000);
