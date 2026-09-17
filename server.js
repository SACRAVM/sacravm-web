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
const LEADS_HEADER = ['fecha_registro','tipo','nombre','email','whatsapp','servicio','fecha_cita','hora_cita','mensaje','instagram','zona','tamano','bebida','ya_tatuado','fuente','tier','fianza','referencias','estado_fianza','recordatorio_enviado','seguimiento_enviado','reactivacion_6m_enviado','reactivacion_1a_enviado','alerta_fianza_enviado','aviso_prep_24h_enviado','artista','estado_solicitud','fecha_aprobacion','alerta_senal_enviado','presupuesto','plazo'];
const ARTISTA_DEFAULT = 'JJ Rodríguez';
const PROVEEDORES_FILE = path.join(DATA_DIR, 'proveedores.csv');
const PROVEEDORES_HEADER = ['fecha_registro','nombre','que_suministra','contacto','telefono','email','condiciones','notas'];
const COLABORACIONES_FILE = path.join(DATA_DIR, 'colaboraciones.csv');
const COLABORACIONES_HEADER = ['fecha_registro','nombre','tipo','contacto_persona','contacto_medio','estado','notas'];
const MATERIALES_FILE = path.join(DATA_DIR, 'materiales.csv');
const MATERIALES_HEADER = ['fecha_registro','nombre','categoria','cantidad_actual','unidad','stock_minimo','proveedor','notas'];
const PEDIDOS_FILE = path.join(DATA_DIR, 'pedidos.csv');
const PEDIDOS_HEADER = ['fecha_registro','fecha_pedido','proveedor','material','cantidad','precio_total','estado','notas'];
const CUENTAS_FILE = path.join(DATA_DIR, 'cuentas.csv');
const CUENTAS_HEADER = ['fecha_registro','fecha','tipo','concepto','categoria','importe','notas'];

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
  calendarToken: '',
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
    { nombre: 'Micro-realismo', descripcion: 'Piezas pequeñas y medias con lectura limpia, profundidad visual y detalle fino pensado para durar bien en piel.', ideal: 'Retratos, símbolos delicados, composiciones precisas.', precio: '250–450€', foto: '/images/galeria/g2.jpg' },
    { nombre: 'Realismo conceptual', descripcion: 'Diseños con carga simbólica, composición estética y narrativa visual construida contigo desde la idea.', ideal: 'Proyectos con significado personal, composiciones únicas.', precio: '350–550€', foto: '/images/galeria/g3.jpg' },
    { nombre: 'Fine line', descripcion: 'Línea fina, limpia y elegante para quienes buscan sutileza, gusto y una estética menos obvia.', ideal: 'Lettering delicado, botánicos, ornamentos sutiles.', precio: 'Desde 90€ · Consultar idea, diseño y disponibilidad', foto: '/images/galeria/g9.jpg' },
  ],
  tarifas: [
    { duracion: '1–2 HORAS', tag: '', nombre: 'Mini tattoo', desc: 'Para piezas pequeñas, limpias y con resultado garantizado — el primer contacto natural con el atelier.', incluye: 'Diseño el mismo día · Kit de cuidados incluido · Repaso incluido (4 meses)', precio: '90–220€', senal: 'Señal 50€', ctaLabel: 'Pedir cita →', bookKey: 'Mini tattoo', thumb: '' },
    { duracion: '3–5 HORAS', tag: 'el formato más solicitado', nombre: 'Media sesión', desc: 'Para piezas de tamaño medio o avances de un proyecto en curso — el equilibrio justo entre tiempo y profundidad.', incluye: 'Diseño el mismo día · Kit de cuidados · Seguimiento de curación · Repaso incluido (4 meses)', precio: '450–550€', senal: 'Señal 100€ · se descuenta del total', ctaLabel: 'Pedir cita →', bookKey: 'Media sesión', thumb: '/media-sesion.jpg' },
    { duracion: '6–8 HORAS', tag: '', nombre: 'Sesión completa', desc: 'Para proyectos exigentes que necesitan tiempo, capas y profundidad de detalle en una sola jornada.', incluye: 'Kit de cuidados completo · Seguimiento de curación · Repaso incluido (4 meses) · Descuento en bloques de proyecto', precio: '750–850€', senal: 'Señal 150€ · se descuenta del total', ctaLabel: 'Pedir cita →', bookKey: 'Sesión completa', thumb: '/sesion-completa.jpg' },
    { duracion: '2+ DÍAS · PROYECTO', tag: '', nombre: 'Gran proyecto', desc: 'Mangas, espaldas y proyectos de envergadura, planificados por bloques con curación entre fases.', incluye: 'Planificación completa · Máx. 3 sesiones por bloque · Seguimiento personalizado', precio: '750–850€/día', senal: 'Señal 200€/sesión · se descuenta del total', ctaLabel: 'Pedir cita →', bookKey: '', thumb: '/gran-proyecto.jpg' },
  ],
  testimonios: [
    { txt: 'No sentí que estuviera entrando a un estudio más, sino a un sitio preparado para escuchar bien la idea y llevarla a un resultado fino y con criterio.', by: 'Claudia M.' },
    { txt: 'La reserva fue clara, la sesión estuvo muy cuidada y todo el proceso se notó pensado para que el tatuaje saliera como tenía que salir.', by: 'Javier R.' },
    { txt: 'Se agradece que no haya prisas ni ruido. JJ se toma el tiempo de entender la idea y eso cambia completamente el resultado.', by: 'Lucía P.' },
  ],
  cuadros: [
    { url: '', nombre: 'Pieza I', meta: 'Bic sobre papel', significado: '', precio: '', galeria: [] },
    { url: '', nombre: 'Pieza II', meta: 'Bic sobre papel', significado: '', precio: '', galeria: [] },
    { url: '', nombre: 'Pieza III', meta: 'Bic sobre papel', significado: '', precio: '', galeria: [] },
  ],
  galeria: [
    { url: '/images/galeria/g9.jpg', estilo: 'FINE LINE', desc: 'Letras' },
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
  estudioFotos: [],
  academyAlumnos: 0,
  academyResultados: [],
  academyTestimonios: [],
  artistas: ['JJ Rodríguez'],
  videoAtelierUrl: '/video/sacravm-atelier.mp4',
  videoAtelierPoster: '/video/sacravm-atelier-poster.jpg',
  textos: {
    // Se muestra arriba del cuestionario del QR. Vacíalo el día que abra el Atelier.
    aperturaAviso: 'El Atelier de Paseo Quintanilla abre sus puertas en las próximas semanas. Estos son los primeros Pases: los proyectos que elijamos ahora son los que inauguran la casa.',
    // Tarifa fundacional. Al vaciar el titular, el bloque desaparece de la web y del QR.
    fundacionalTitulo: '750€ hasta que abramos. Después, 1.000€.',
    fundacionalTexto: 'El día que el Atelier abra sus puertas, la sesión pasa a 1.000€ para todo el mundo. Sin excepciones y sin vuelta atrás.\n\nQuien tenga el Pase concedido antes de ese día se queda en 750€ — y se queda ahí para todo el proyecto, aunque las sesiones se alarguen meses. El precio se fija el día que te lo concedemos, no el día que te sientas en la camilla.\n\nY no es un truco de urgencia. Aceptamos muy pocos proyectos fundacionales precisamente para poder volcarnos entero en cada uno. Quien entra ahora confía en un Atelier que todavía no ha abierto sus puertas; eso se reconoce con precio, no con promesas.',
    valeRegaloTitulo: 'Regala algo único.\nY para siempre.',
    valeRegaloTexto: 'Unas flores se marchitan. Una cena se olvida. Un tatuaje de SACRAVM se queda para siempre — y lleva tu gesto dentro. Elige un importe, desde SACRAVM nos encargamos del resto.',
    inversionTitulo: 'Cada formato, pensado para que el resultado esté a la altura',
    inversionTexto: 'El diseño se prepara en exclusiva para tu Pase. La señal lo confirma y se descuenta del total — el resto se abona al cerrar la sesión.',
    academyTitulo: 'Domina el oficio con quien ya se lo juega en piel real.',
    academyTexto: 'Un programa online de 3-6 meses para tatuadores que no quieren aprender por prueba y error. Técnica, criterio, marca personal y captación de clientes.',
  },
};

// Lee content.json y rellena con los valores por defecto cualquier clave que
// todavía no exista en el archivo real (p.ej. cuando se añade un campo nuevo
// a DEFAULT_CONTENT después de que la web ya lleve tiempo en producción).
function readContent() {
  const guardado = readJSON(CONTENT_FILE, {});
  const merged = Object.assign({}, DEFAULT_CONTENT, guardado);
  // Object.assign es superficial: si no se fusiona 'textos' aparte, el bloque
  // guardado en disco tapa entero al de por defecto y cualquier texto nuevo
  // (aviso de apertura, tarifa fundacional...) no llega nunca a la web.
  // Un valor vacío guardado sí gana: así vaciar un texto desde el panel funciona.
  merged.textos = Object.assign({}, DEFAULT_CONTENT.textos, guardado.textos || {});
  return merged;
}

// ── CSV (leads) ─────────────────────────────────────────────────────
function csvEscape(val) {
  const s = (val === undefined || val === null) ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function appendLead(data, referenciasPaths) {
  ensureDirs();
  const row = [
    // Normalmente es "ahora", pero al importar contactos antiguos se puede pasar
    // fecha_registro para conservar la fecha real en que escribió esa persona.
    data.fecha_registro || new Date().toLocaleString('es-ES'), data.tipo || '', data.nombre || '', data.email || '',
    data.whatsapp || '', data.servicio || '', data.fecha || '', data.hora || '', data.mensaje || '', data.instagram || '',
    data.zona || '', data.tamano || '', data.bebida || '', data.ya_tatuado || '', data.fuente || '',
    data.tier || '', data.fianza || '',
    (referenciasPaths || []).join(';'),
    data.estado_fianza === 'pagada' ? 'pagada' : '', // se puede marcar ya cobrada al crear la ficha manual
    '', '', '', '', '', '', // recordatorio_enviado, seguimiento_enviado, reactivacion_6m_enviado, reactivacion_1a_enviado, alerta_fianza_enviado, aviso_prep_24h_enviado — los rellena el planificador de emails
    data.artista || ARTISTA_DEFAULT,
    // '' en fichas antiguas = ya estaban confirmadas (flujo anterior). Las
    // solicitudes nuevas de la web nacen en 'pendiente' hasta que JJ las revisa.
    data.estado_solicitud || '',
    '', '', // fecha_aprobacion, alerta_senal_enviado — los rellena el visto bueno y el planificador
    data.presupuesto || '', data.plazo || '',
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
// Borra un lead por su número de fila. Devuelve false si esa fila ya no existe
// (por ejemplo si se borró en otra pestaña), para no romper nada en silencio.
function deleteLead(rowIndex) {
  const { headers, rows } = readLeadsRaw();
  const idx = rows.findIndex(r => r._row === rowIndex);
  if (idx === -1) return false;
  rows.splice(idx, 1);
  writeLeadsRaw(headers, rows);
  return true;
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
// Estado de la solicitud. Las fichas creadas antes de este flujo tienen la
// columna vacía: eran citas ya confirmadas, así que cuentan como aprobadas.
function esPendiente(row) { return (row.estado_solicitud || '') === 'pendiente'; }
function esRechazada(row) { return (row.estado_solicitud || '') === 'rechazada'; }

function readOcupados() {
  const { rows } = readLeadsRaw();
  return rows
    // Una solicitud pendiente bloquea el hueco provisionalmente para que no se
    // pida dos veces el mismo día. Si se rechaza, el hueco vuelve a liberarse.
    .filter(r => r.tipo === 'reserva' && r.fecha_cita && !esRechazada(r))
    .map(r => ({ fecha: r.fecha_cita, hora: r.hora_cita }));
}

// ── Calendario suscribible (.ics) — para verlo automáticamente en el Calendario del iPhone ──
// Token de acceso: solo quien tenga esta URL puede ver las citas, no hace falta login
// (las apps de calendario no saben iniciar sesión, así que el "secreto" va en la propia URL).
function getOrCreateCalendarToken() {
  const content = readContent();
  if (content.calendarToken) return content.calendarToken;
  content.calendarToken = crypto.randomBytes(16).toString('hex');
  writeJSON(CONTENT_FILE, content);
  return content.calendarToken;
}
function regenerateCalendarToken() {
  const content = readContent();
  content.calendarToken = crypto.randomBytes(16).toString('hex');
  writeJSON(CONTENT_FILE, content);
  return content.calendarToken;
}
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}
// Duración estimada por tipo de servicio, solo para bloquear un hueco razonable en el calendario
// (la duración real de cada Pase varía — JJ puede ajustar el evento a mano si hace falta).
function estimarDuracionHoras(servicio) {
  const s = (servicio || '').toLowerCase();
  if (s.includes('valoración') || s.includes('valoracion')) return 0.5;
  if (s.includes('mini')) return 2;
  if (s.includes('media')) return 5;
  if (s.includes('completa')) return 8;
  if (s.includes('proyecto')) return 8;
  return 3;
}
// quien: undefined/'todos' = todas las citas: 'jj' = solo JJ Rodríguez (o citas antiguas sin
// artista asignado, que se consideran suyas por defecto); 'otros' = cualquier otro artista.
// Así, suscribiendo el feed de JJ y el de "otros" como DOS calendarios separados en el iPhone,
// cada uno puede llevar su propio color — un calendario suscrito no permite colorear evento a
// evento, solo por calendario entero.
function esDeJJ(artista) { return !artista || artista.trim() === ARTISTA_DEFAULT; }
function buildCalendarIcs(quien) {
  const { rows } = readLeadsRaw();
  // Los proyectos rechazados no ocupan agenda. Los que están por elegir sí
  // aparecen, pero marcados con ● para no confundirlos con un Pase concedido.
  let citas = rows.filter(r => r.tipo === 'reserva' && r.fecha_cita && !esRechazada(r));
  if (quien === 'jj') citas = citas.filter(r => esDeJJ(r.artista));
  else if (quien === 'otros') citas = citas.filter(r => !esDeJJ(r.artista));
  const calName = quien === 'jj' ? 'SACRAVM · JJ Rodríguez' : quien === 'otros' ? 'SACRAVM · Otros artistas' : 'SACRAVM · Pases';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SACRAVM//Pases//ES',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:' + calName,
    'X-WR-TIMEZONE:Europe/Madrid',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  citas.forEach(r => {
    const [y, m, d] = r.fecha_cita.split('-').map(n => parseInt(n, 10));
    const horaOk = /^\d{1,2}:\d{2}$/.test(r.hora_cita || '');
    const [hh, mm] = horaOk ? r.hora_cita.split(':').map(n => parseInt(n, 10)) : [10, 0];
    const start = new Date(y, (m || 1) - 1, d || 1, hh, mm);
    const durH = estimarDuracionHoras(r.servicio);
    const end = new Date(start.getTime() + durH * 3600000);
    const fmt = dt => dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0')
      + 'T' + String(dt.getHours()).padStart(2, '0') + String(dt.getMinutes()).padStart(2, '0') + '00';
    const uid = crypto.createHash('md5').update([r.fecha_cita, r.hora_cita, r.nombre, r.servicio].join('|')).digest('hex') + '@sacravm';
    const artista = r.artista || ARTISTA_DEFAULT;
    const descParts = [
      'Artista: ' + artista,
      r.servicio ? 'Servicio: ' + r.servicio : '',
      r.whatsapp ? 'WhatsApp: ' + r.whatsapp : '',
      r.email ? 'Email: ' + r.email : '',
      r.fianza ? 'Señal: ' + r.fianza + '€ (' + (r.estado_fianza === 'pagada' ? 'pagada' : 'pendiente') + ')' : '',
      r.mensaje ? 'Idea: ' + r.mensaje : '',
    ].filter(Boolean).map(icsEscape).join('\\n');
    // En el feed combinado (sin filtrar) se marca quién no es JJ en el propio título,
    // para que se distinga incluso si alguien solo suscribe ese calendario único.
    const summaryArtista = (!quien && !esDeJJ(r.artista)) ? ' · ' + artista : '';
    const marcaPendiente = esPendiente(r) ? '● POR ELEGIR · ' : '';
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + dtstamp,
      'DTSTART:' + fmt(start),
      'DTEND:' + fmt(end),
      'SUMMARY:' + icsEscape(marcaPendiente + (r.nombre || 'Pase') + (r.servicio ? ' · ' + r.servicio : '') + summaryArtista),
      'DESCRIPTION:' + descParts,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
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
      httpRes.on('end', () => {
        // Hasta ahora los fallos de envío eran mudos: si Resend rechazaba un
        // correo no quedaba rastro en ningún sitio. Ahora sale en los logs de
        // Render con el motivo exacto.
        if (httpRes.statusCode >= 300) {
          console.error('✗ Email NO enviado a ' + to + ' — ' + httpRes.statusCode + ' ' + body.slice(0, 300));
        } else {
          console.log('✓ Email enviado a ' + to + ' — ' + subject);
        }
        resolve({ ok: httpRes.statusCode < 300, status: httpRes.statusCode, body });
      });
    });
    httpReq.on('error', (e) => { console.error('✗ Email NO enviado a ' + to + ' — ' + e.message); resolve({ ok: false, error: e.message }); });
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
    subject: `Tu Pase en SACRAVM — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Tu Pase ha quedado confirmado:</p>
      <p><strong>Fecha:</strong> ${fecha}<br><strong>Hora:</strong> ${lead.hora_cita || ''}<br><strong>Servicio:</strong> ${lead.servicio || ''}</p>
      <p>Para dejarla confirmada del todo, recuerda completar el pago de la fianza por Bizum si aún no lo has hecho.</p>
      <p>Unos días antes te escribo con todo lo que conviene saber antes de la sesión.</p>
      <p>Cualquier duda, escríbeme sin problema.</p>
    `),
  };
}

function emailConfirmacionValoracion(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `Tu valoración en SACRAVM — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Tu valoración y diseño ha quedado reservada, sin coste:</p>
      <p><strong>Fecha:</strong> ${fecha}<br><strong>Hora:</strong> ${lead.hora_cita || ''}</p>
      <p>Hablamos de tu idea, resolvemos dudas y vemos si encaja con lo que buscas — sin compromiso de reservar nada más.</p>
      <p>Cualquier duda antes de la llamada, escríbeme sin problema.</p>
    `),
  };
}

// ══ Flujo de solicitud: pedir → revisar → aprobar ═══════════════════
// La web ya no confirma citas sola. El cliente manda una solicitud, JJ la
// revisa en el panel y solo entonces se le da el visto bueno con la señal.

function emailSolicitudRecibida(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  const esConsulta = lead.tier === 'consulta';
  return {
    subject: `Tu proyecto está en el Atelier — SACRAVM`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Tu proyecto ya está en mis manos. <strong>Todavía no es un Pase concedido</strong>: cada mes el Atelier abre un número limitado y elijo cada proyecto uno a uno.</p>
      <p><strong>Lo que has pedido:</strong><br>
      ${esConsulta ? 'Valoración y diseño' : (lead.servicio || 'Sesión de tatuaje')}<br>
      Fecha preferida: ${fecha}${lead.hora_cita ? ' · ' + lead.hora_cita : ''}</p>
      <p>Te respondo en un máximo de <strong>48 horas</strong>. Si hay Pase para ti, te escribo con la fecha y las instrucciones para dejar la señal — <em>hasta ese momento no tienes que pagar nada</em>.</p>
      <p>Si necesito entender mejor el proyecto antes de decidir, te escribo también.</p>
    `),
  };
}

function emailAprobacion(lead, cfg) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  const fianza = lead.fianza || '';
  const esConsulta = lead.tier === 'consulta';
  const concepto = (lead.nombre || 'tu nombre') + ' - cita';
  const stripeLink = cfg['stripeLink' + fianza] || '';
  let pago = '';
  if (!esConsulta && fianza) {
    pago = `<p style="margin-top:24px"><strong>Para confirmarlo: señal de ${fianza}€</strong> (se descuenta del total al terminar la sesión).</p>`;
    if (stripeLink) {
      pago += `<p><a href="${stripeLink}" style="display:inline-block;background:#1C1714;color:#fff;text-decoration:none;padding:12px 22px;letter-spacing:.08em;font-size:13px">PAGAR LA SEÑAL →</a></p>`;
      if (cfg.bizum) pago += `<p style="font-size:13px;color:#6B6460">¿Prefieres Bizum? ${fianza}€ al ${cfg.bizum}, concepto: <strong>${concepto}</strong></p>`;
    } else if (cfg.bizum) {
      pago += `<p>Bizum de ${fianza}€ al <strong>${cfg.bizum}</strong><br>Concepto: <strong>${concepto}</strong></p>`;
    }
    pago += `<p style="font-size:13px;color:#6B6460">Tienes <strong>48 horas</strong> para dejarla. Pasado ese plazo el Pase vuelve a abrirse — hay más proyectos esperando.</p>`;
    // El compromiso de precio va por escrito en el correo: es lo que vale si
    // algún día hay una discusión sobre cuánto se acordó.
    pago += `<p style="margin-top:18px;padding:12px 14px;background:#F5EFE4;border-left:2px solid #8B5E2A;font-size:13px;color:#1C1714">
      <strong>Tu precio queda fijado hoy.</strong> Cuando el Atelier abra sus puertas la tarifa sube, pero a ti no te afecta: tu proyecto mantiene el precio con el que te concedí el Pase, de principio a fin, aunque las sesiones se alarguen meses.</p>`;
  }
  return {
    subject: esConsulta ? `Confirmada tu valoración — ${fecha}` : `Pase concedido — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>${esConsulta
        ? 'He revisado tu solicitud y te confirmo la valoración. Es gratuita y sin compromiso.'
        : 'He leído tu proyecto y lo he elegido. <strong>Tienes Pase.</strong>'}</p>
      <p><strong>Fecha:</strong> ${fecha}<br><strong>Hora:</strong> ${lead.hora_cita || ''}<br><strong>Servicio:</strong> ${lead.servicio || ''}</p>
      ${pago}
      <p>Unos días antes te escribo con todo lo que conviene saber para llegar preparado.</p>
      <p style="font-style:italic;color:#8B5E2A">Tu historia merece ser eterna.</p>
    `),
  };
}

function emailNoEncaja(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  return {
    subject: `Sobre tu proyecto — SACRAVM`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Gracias por escribirme y por contarme tu proyecto con detalle. Lo he leído entero.</p>
      <p>Esta vez no hay Pase para él. No es un juicio sobre tu idea: es que no es un proyecto al que pueda aportar lo que quiero aportar, y prefiero decírtelo antes que hacerlo a medias.</p>
      <p>Si en algún momento quieres darle otra vuelta al concepto, escríbeme y lo vemos sin problema.</p>
    `),
  };
}

function emailSenalSinPagar(lead) {
  return {
    subject: `⚠ Señal sin pagar — ${lead.nombre || 'sin nombre'} (Pase concedido hace 48 h)`,
    html: EMAIL_WRAP(`
      <p>Concediste este Pase hace 48 h y la señal <strong>sigue sin entrar</strong>.</p>
      <p>${lead.nombre || 'Sin nombre'}<br>${lead.email || ''} · ${lead.whatsapp || 'sin teléfono'}<br>
      Cita: ${fmtFechaEs(lead.fecha_cita)} ${lead.hora_cita || ''} · Señal: ${lead.fianza || ''}€</p>
      <p>O le das un toque, o retiras el Pase. Si lo retiras, márcalo como <strong>No encaja</strong> en el panel y la fecha vuelve al calendario.</p>
    `),
  };
}

function emailNuevaSolicitud(lead) {
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `● Proyecto por elegir: ${lead.nombre || 'sin nombre'} — ${fecha}`,
    html: EMAIL_WRAP(`
      <p><strong>Nuevo proyecto esperando a que decidas.</strong></p>
      <p>${lead.nombre || 'Sin nombre'}<br>
      ${lead.email || ''} · ${lead.whatsapp || 'sin teléfono'}</p>
      <p><strong>Pide:</strong> ${lead.servicio || ''} · ${fecha} ${lead.hora_cita || ''}<br>
      <strong>Zona:</strong> ${lead.zona || 'no indicada'} · <strong>Tamaño:</strong> ${lead.tamano || 'no indicado'}<br>
      <strong>Presupuesto:</strong> ${lead.presupuesto || 'no indicado'} · <strong>Plazo:</strong> ${lead.plazo || 'no indicado'}${lead.instagram ? '<br><strong>Instagram:</strong> @' + lead.instagram : ''}</p>
      <p><strong>Idea:</strong><br>${(lead.mensaje || '').replace(/</g, '&lt;')}</p>
      <p>Léelo en el panel y dale a <strong>Conceder Pase</strong> o <strong>No encaja</strong>. Hasta entonces no se le pide la señal.</p>
    `),
  };
}

// ══ Lista privada de apertura (landing del QR / flyer) ══════════════
// No es una cita: es un registro en la lista con la que se abrirá el
// calendario. El correo confirma la entrada, no promete fecha.
function emailListaEspera(lead, posicion) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const historico = lead.tier === 'historico';
  const proyecto = [lead.servicio, lead.zona].filter(Boolean).join(' · ') || 'Por definir';
  // El número de puesto solo suma si ya hay lista de verdad: decirle a alguien
  // que es el nº 2 delata que la lista está vacía. A partir de 10, refuerza.
  const puesto = posicion >= 10 ? posicion : 0;
  const filete = '<div style="width:42px;height:1px;background:#8C6B3E;opacity:.5;margin:26px 0"></div>';
  return {
    subject: `Estás dentro · Lista privada de SACRAVM`,
    html: EMAIL_WRAP(`
      <p style="font-size:11px;letter-spacing:.3em;color:#8C6B3E;text-transform:uppercase;margin-bottom:26px">Lista privada de apertura · León</p>
      <p>${nombre},</p>
      <p style="font-family:Georgia,serif;font-size:21px;line-height:1.5;margin:18px 0"><em>Estás dentro.</em></p>
      <p>Tu nombre queda inscrito en la lista privada con la que SACRAVM abrirá sus puertas${puesto ? `, en el lugar <strong>nº ${puesto}</strong>` : ''}. Un círculo reducido, anterior a cualquier agenda pública.</p>
      <p>Esta lista no se anuncia ni se compra. Es, sencillamente, el orden en que se abrirán las primeras citas del Atelier.</p>
      ${filete}
      <p style="font-size:11px;letter-spacing:.24em;color:#6B6460;text-transform:uppercase;margin-bottom:8px">Tu inscripción</p>
      <p style="font-family:Georgia,serif;font-size:17px;margin-bottom:4px">${proyecto}</p>
      <p style="font-size:13px;color:#8B5E2A;letter-spacing:.06em">${historico ? 'Acceso prioritario · Cliente histórico' : 'Nueva solicitud · En proceso de selección'}</p>
      ${filete}
      <p>${historico
        ? 'Ya llevas una obra mía en la piel, así que tu solicitud entra directa en la agenda de apertura: serás de los primeros en recibir fecha.'
        : 'Cada proyecto se estudia uno a uno. Si el tuyo encaja con lo que hacemos, te escribiremos para hablarlo antes de abrir fecha.'}</p>
      <p><strong>Mantente atento: anunciaremos las primeras fechas muy pronto.</strong> Cuando el calendario se abra, quienes estáis en esta lista lo sabréis antes que nadie.</p>
      <p style="font-family:Georgia,serif;font-size:18px;color:#8B5E2A;margin-top:28px">Te damos la bienvenida al Templo.</p>
      <p style="font-size:13px;color:#6B6460;margin-top:22px">Conserva este mensaje: acredita tu lugar en la lista.</p>
    `),
  };
}

function emailNuevoListaEspera(lead, posicion) {
  const via = lead.tier === 'historico' ? 'Cliente histórico / Coleccionista' : 'Nueva solicitud';
  return {
    subject: `✦ Lista de apertura${posicion ? ' (nº ' + posicion + ')' : ''}: ${lead.nombre || 'sin nombre'}`,
    html: EMAIL_WRAP(`
      <p><strong>Alguien acaba de entrar en la lista privada de apertura.</strong></p>
      <p>${lead.nombre || 'Sin nombre'}<br>
      ${lead.email || ''} · ${lead.whatsapp || 'sin teléfono'}</p>
      <p><strong>Vía:</strong> ${via}<br>
      <strong>Proyecto:</strong> ${lead.servicio || 'no indicado'}<br>
      <strong>Zona o detalle:</strong> ${lead.zona || 'no indicada'}<br>
      <strong>Origen:</strong> ${lead.fuente || 'no indicado'}</p>
      <p>Lo tienes en el panel con la etiqueta <strong>lista-espera</strong>. No se le ha prometido fecha: solo que le escribirás antes de la apertura.</p>
    `),
  };
}

function emailRecordatorioValoracion(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `Tu valoración es en 2 días — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Recordatorio de tu valoración y diseño, el <strong>${fecha}${lead.hora_cita ? ' a las ' + lead.hora_cita : ''}</strong>.</p>
      <p>Si tienes referencias o ideas ya pensadas, tenlas a mano — nos ayuda a aprovechar mejor el tiempo.</p>
      <p>Nos vemos pronto.</p>
    `),
  };
}

function emailRecordatorio(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `Tu Pase es en 2 días — ${fecha}`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Te escribo porque tu Pase es en dos días, el <strong>${fecha}${lead.hora_cita ? ' a las ' + lead.hora_cita : ''}</strong>.</p>
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

function emailReactivacion6m(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  return {
    subject: `Han pasado 6 meses — ¿qué tal sigue tu tatuaje?`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Ya han pasado 6 meses desde tu sesión en SACRAVM — espero que la pieza haya asentado perfecta.</p>
      <p>Si te apetece retocarla, seguirla con algo nuevo, o simplemente pasarte por el Atelier a saludar, aquí tienes las puertas abiertas.</p>
      <p>Un abrazo,</p>
    `),
  };
}

function emailReactivacion1a(lead) {
  const nombre = (lead.nombre || '').split(' ')[0] || 'Hola';
  return {
    subject: `Un año ya de tu tatuaje — te esperamos en el Atelier`,
    html: EMAIL_WRAP(`
      <p>Hola ${nombre},</p>
      <p>Se cumple un año desde tu sesión en SACRAVM. Si tienes en mente una nueva pieza, un retoque, o simplemente te apetece pasarte por el Atelier, este es tu recordatorio para hacerlo.</p>
      <p>Siempre es un placer verte de nuevo.</p>
    `),
  };
}

// Aviso para JJ (no para el cliente): la cita es en 2 días y la fianza sigue sin marcarse como pagada.
function emailAvisoFianza(lead) {
  const fecha = fmtFechaEs(lead.fecha_cita);
  return {
    subject: `⚠ Fianza pendiente — cita en 2 días: ${lead.nombre || 'sin nombre'}`,
    html: EMAIL_WRAP(`
      <p>La cita de <strong>${lead.nombre || 'sin nombre'}</strong> es en 2 días (${fecha}${lead.hora_cita ? ' a las ' + lead.hora_cita : ''}) y la fianza todavía no está marcada como pagada.</p>
      <p>Teléfono: ${lead.whatsapp || 'no indicado'}<br>Servicio: ${lead.servicio || ''}<br>Fianza: ${lead.fianza || ''}€</p>
      <p>Revisa y marca la fianza en tu <a href="https://sacravm-web.onrender.com/agenda">Agenda SACRAVM</a> si ya la has cobrado.</p>
    `),
  };
}

// Aviso a JJ 24h antes de cada cita real (no valoraciones), con todo lo necesario para prepararla.
function emailAvisoPreparacion(lead) {
  const fecha = fmtFechaEs(lead.fecha_cita);
  const refsCount = (lead.referencias || '').split(';').filter(Boolean).length;
  return {
    subject: `Mañana: ${lead.nombre || 'sin nombre'} — ${lead.servicio || 'cita'} (${lead.hora_cita || ''})`,
    html: EMAIL_WRAP(`
      <p>Mañana ${fecha}${lead.hora_cita ? ' a las ' + lead.hora_cita : ''} tienes cita con <strong>${lead.nombre || 'sin nombre'}</strong>. Info para preparártela:</p>
      <p>
        Servicio: ${lead.servicio || 'no indicado'}<br>
        Zona: ${lead.zona || 'no indicada'}<br>
        Tamaño: ${lead.tamano || 'no indicado'}<br>
        ¿Ya tatuado antes?: ${lead.ya_tatuado || 'no indicado'}<br>
        Bebida preferida: ${lead.bebida || 'no indicada'}<br>
        Teléfono: ${lead.whatsapp || 'no indicado'}<br>
        Fianza: ${lead.fianza ? lead.fianza + '€ (' + (lead.estado_fianza === 'pagada' ? 'pagada' : 'pendiente') + ')' : 'no indicada'}
      </p>
      <p><strong>Idea del cliente:</strong><br>${(lead.mensaje || 'sin mensaje').replace(/\n/g, '<br>')}</p>
      ${refsCount ? `<p>${refsCount} imagen(es) de referencia subidas — velas en <a href="https://sacravm-web.onrender.com/admin">el admin</a>, pestaña Leads.</p>` : ''}
    `),
  };
}

// Comprueba citas para las que toca mandar recordatorio (2 días antes),
// seguimiento (7 días después) o reactivación (6 meses / 1 año después),
// y las envía una sola vez por cita.
async function runEmailScheduler() {
  try {
    const { headers, rows } = readLeadsRaw();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const in1day = new Date(today); in1day.setDate(in1day.getDate() + 1);
    const in2days = new Date(today); in2days.setDate(in2days.getDate() + 2);
    const ago2days = new Date(today); ago2days.setDate(ago2days.getDate() - 2);
    const ago7days = new Date(today); ago7days.setDate(ago7days.getDate() - 7);
    const ago180days = new Date(today); ago180days.setDate(ago180days.getDate() - 180);
    const ago365days = new Date(today); ago365days.setDate(ago365days.getDate() - 365);
    const in1Str = fmt(in1day), in2Str = fmt(in2days), ago2Str = fmt(ago2days), ago7Str = fmt(ago7days), ago180Str = fmt(ago180days), ago365Str = fmt(ago365days);
    const jjEmail = readContent().email;
    let changed = false;
    for (const row of rows) {
      if (row.tipo !== 'reserva') continue;
      // Aprobada hace 2 días y la señal sin entrar: aviso a JJ para que decida.
      if (row.estado_solicitud === 'aprobada' && row.tier !== 'consulta' && row.fecha_aprobacion === ago2Str
          && row.estado_fianza !== 'pagada' && row.alerta_senal_enviado !== 'si' && jjEmail) {
        const { subject, html } = emailSenalSinPagar(row);
        const r = await sendEmail(jjEmail, subject, html);
        if (r.ok) { row.alerta_senal_enviado = 'si'; changed = true; }
      }
      if (!row.fecha_cita) continue;
      // Una solicitud sin aprobar no es una cita: no manda recordatorios ni avisos.
      if (esPendiente(row) || esRechazada(row)) continue;
      // Aviso a JJ para prepararse: 24h antes de CUALQUIER cita (incluidas valoraciones).
      if (row.fecha_cita === in1Str && row.aviso_prep_24h_enviado !== 'si' && jjEmail) {
        const { subject, html } = emailAvisoPreparacion(row);
        const r = await sendEmail(jjEmail, subject, html);
        if (r.ok) { row.aviso_prep_24h_enviado = 'si'; changed = true; }
      }
      // Aviso a JJ (independiente de si el cliente puso email): fianza sin cobrar a 2 días de la cita.
      // No aplica a valoraciones (tier 'consulta'), que son gratuitas y no llevan fianza.
      if (row.tier !== 'consulta' && row.fecha_cita === in2Str && row.estado_fianza !== 'pagada' && row.alerta_fianza_enviado !== 'si' && jjEmail) {
        const { subject, html } = emailAvisoFianza(row);
        const r = await sendEmail(jjEmail, subject, html);
        if (r.ok) { row.alerta_fianza_enviado = 'si'; changed = true; }
      }
      if (!row.email) continue;
      const esConsulta = row.tier === 'consulta';
      if (row.fecha_cita === in2Str && row.recordatorio_enviado !== 'si') {
        const { subject, html } = esConsulta ? emailRecordatorioValoracion(row) : emailRecordatorio(row);
        const r = await sendEmail(row.email, subject, html);
        if (r.ok) { row.recordatorio_enviado = 'si'; changed = true; }
      }
      // El seguimiento de curación solo aplica a sesiones de tatuaje reales, no a valoraciones
      if (!esConsulta && row.fecha_cita === ago7Str && row.seguimiento_enviado !== 'si') {
        const { subject, html } = emailSeguimiento(row);
        const r = await sendEmail(row.email, subject, html);
        if (r.ok) { row.seguimiento_enviado = 'si'; changed = true; }
      }
      if (row.fecha_cita === ago180Str && row.reactivacion_6m_enviado !== 'si') {
        const { subject, html } = emailReactivacion6m(row);
        const r = await sendEmail(row.email, subject, html);
        if (r.ok) { row.reactivacion_6m_enviado = 'si'; changed = true; }
      }
      if (row.fecha_cita === ago365Str && row.reactivacion_1a_enviado !== 'si') {
        const { subject, html } = emailReactivacion1a(row);
        const r = await sendEmail(row.email, subject, html);
        if (r.ok) { row.reactivacion_1a_enviado = 'si'; changed = true; }
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

// ── Almacenes simples (proveedores, colaboraciones) ─────────────────
// Mismo patrón que leads.csv pero sin campos específicos de reserva.
function ensureSimpleCsv(file, header) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, header.join(',') + '\n', 'utf8');
}
function readSimpleCsv(file, header) {
  ensureSimpleCsv(file, header);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];
  const fileHeader = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, i) => {
    const vals = parseCsvLine(line);
    const obj = { _row: i };
    fileHeader.forEach((h, j) => obj[h] = vals[j] || '');
    return obj;
  });
}
function writeSimpleCsv(file, header, rows) {
  const lines = [header.join(',')];
  rows.forEach(r => lines.push(header.map(h => csvEscape(r[h])).join(',')));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}
function appendSimpleCsv(file, header, data) {
  ensureSimpleCsv(file, header);
  const row = header.map(h => h === 'fecha_registro' ? new Date().toLocaleString('es-ES') : (data[h] || '')).map(csvEscape).join(',');
  fs.appendFileSync(file, row + '\n', 'utf8');
}
function updateSimpleCsvRow(file, header, rowIndex, fields) {
  const rows = readSimpleCsv(file, header);
  const row = rows.find(r => r._row === rowIndex);
  if (!row) return false;
  Object.keys(fields).forEach(k => { if (header.includes(k)) row[k] = fields[k] == null ? '' : String(fields[k]); });
  writeSimpleCsv(file, header, rows);
  return true;
}
const SIMPLE_STORES = {
  proveedores: { file: PROVEEDORES_FILE, header: PROVEEDORES_HEADER },
  colaboraciones: { file: COLABORACIONES_FILE, header: COLABORACIONES_HEADER },
  materiales: { file: MATERIALES_FILE, header: MATERIALES_HEADER },
  pedidos: { file: PEDIDOS_FILE, header: PEDIDOS_HEADER },
  cuentas: { file: CUENTAS_FILE, header: CUENTAS_HEADER },
};

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

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

const server = http.createServer(async (req, res) => {
  ensureDirs();
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    // ═══ API pública ═══
    if (pathname === '/api/content' && req.method === 'GET') {
      // No exponer el token del calendario aquí — este endpoint no requiere sesión
      // (lo usa la propia web pública) y ese token es lo único que protege tus citas.
      const { calendarToken, ...publicContent } = readContent();
      return sendJSON(res, 200, publicContent);
    }
    // Enlace del calendario suscribible — requiere sesión, a diferencia de /api/content
    if (pathname === '/api/calendar-token' && req.method === 'GET') {
      if (!getSession(req)) return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
      return sendJSON(res, 200, { ok: true, token: getOrCreateCalendarToken() });
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
      // Las solicitudes que llegan de la web nacen pendientes de revisión: la web
      // ya no confirma citas sola. Las fichas creadas a mano desde el panel son
      // citas que JJ ya ha cerrado por su cuenta, así que entran aprobadas.
      const desdeAdmin = data.origen === 'admin';
      if (data.tipo === 'reserva') data.estado_solicitud = desdeAdmin ? 'aprobada' : 'pendiente';
      appendLead(data, referenciasPaths);
      console.log('✓ Nuevo lead:', data.tipo, '-', data.nombre || data.email, data.estado_solicitud ? `[${data.estado_solicitud}]` : '', referenciasPaths.length ? `(${referenciasPaths.length} refs)` : '');
      sendJSON(res, 200, { ok: true }, { 'Access-Control-Allow-Origin': '*' });
      // Emails — no bloquean la respuesta al cliente
      const leadInfo = { nombre: data.nombre, fecha_cita: data.fecha, hora_cita: data.hora, servicio: data.servicio, tier: data.tier, mensaje: data.mensaje, zona: data.zona, tamano: data.tamano, email: data.email, whatsapp: data.whatsapp, instagram: data.instagram, presupuesto: data.presupuesto, plazo: data.plazo, fuente: data.fuente };
      if (data.tipo === 'reserva' && !desdeAdmin) {
        // Al cliente: acuse de recibo, NO confirmación.
        if (data.email) {
          const m = emailSolicitudRecibida(leadInfo);
          sendEmail(data.email, m.subject, m.html).catch(() => {});
        }
        // A JJ: avisar de que hay algo que revisar.
        const jjEmail = readContent().email;
        if (jjEmail) {
          const m = emailNuevaSolicitud(leadInfo);
          sendEmail(jjEmail, m.subject, m.html).catch(() => {});
        }
      } else if (data.tipo === 'lista-espera') {
        // Registro desde la landing de apertura: acuse de recibo al cliente y
        // aviso a JJ, porque si no nadie se entera de que ha entrado.
        let posicion = 0;
        try { posicion = readLeadsRaw().rows.filter(r => r.tipo === 'lista-espera').length; } catch (e) {}
        if (data.email) {
          const m = emailListaEspera(leadInfo, posicion);
          sendEmail(data.email, m.subject, m.html).catch(() => {});
        }
        const jjMail = readContent().email;
        if (!jjMail) console.error('✗ No hay email de aviso configurado en el panel: nadie se entera del registro.');
        if (jjMail) {
          const m = emailNuevoListaEspera(leadInfo, posicion);
          sendEmail(jjMail, m.subject, m.html).catch(() => {});
        }
      } else if (data.tipo === 'reserva' && data.email) {
        const { subject, html } = data.tier === 'consulta' ? emailConfirmacionValoracion(leadInfo) : emailConfirmacion(leadInfo);
        sendEmail(data.email, subject, html).catch(() => {});
      }
      return;
    }
    // Fechas/horas ya reservadas — para pintar el calendario de citas en verde/rojo
    if (pathname === '/api/ocupados' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, ocupados: readOcupados() });
    }

    // Calendario suscribible (.ics) — lo añade el iPhone como "Calendario suscrito" y se
    // actualiza solo. Protegido por token en la URL en vez de login (las apps de calendario
    // no saben iniciar sesión).
    if (pathname === '/api/calendario.ics' && req.method === 'GET') {
      if (parsed.query.token !== getOrCreateCalendarToken()) {
        return sendJSON(res, 403, { ok: false, error: 'Enlace de calendario no válido.' });
      }
      const quien = ['jj', 'otros'].includes(parsed.query.quien) ? parsed.query.quien : undefined;
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      return res.end(buildCalendarIcs(quien));
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
    const protectedRoutes = ['/api/content', '/api/upload-photo', '/api/change-password', '/api/leads', '/api/lead-status', '/api/lead-edit', '/api/lead-delete', '/api/lead-decision'];
    const isProtectedWrite = (pathname === '/api/content' && req.method === 'POST') ||
      pathname === '/api/upload-photo' || pathname === '/api/change-password' ||
      (pathname === '/api/leads' && req.method === 'GET') ||
      (pathname === '/api/lead-status' && req.method === 'POST') ||
      (pathname === '/api/lead-edit' && req.method === 'POST') ||
      (pathname === '/api/lead-delete' && req.method === 'POST') ||
      (pathname === '/api/lead-decision' && req.method === 'POST');

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
      const EDITABLE_LEAD_FIELDS = ['nombre', 'email', 'whatsapp', 'instagram', 'servicio', 'fecha_registro', 'fecha_cita', 'hora_cita', 'mensaje', 'zona', 'tamano', 'bebida', 'ya_tatuado', 'fuente', 'artista', 'fianza', 'estado_fianza', 'estado_solicitud', 'presupuesto', 'plazo'];
      const body = JSON.parse(await readBody(req, 2e5) || '{}');
      const rowIndex = Number(body.rowIndex);
      if (Number.isNaN(rowIndex)) return sendJSON(res, 400, { ok: false, error: 'Falta rowIndex.' });
      const fields = {};
      EDITABLE_LEAD_FIELDS.forEach(k => { if (Object.prototype.hasOwnProperty.call(body.fields || {}, k)) fields[k] = body.fields[k]; });
      const ok = updateLeadFields(rowIndex, fields);
      return sendJSON(res, ok ? 200 : 404, { ok });
    }

    // Borrado de un lead. La confirmación se pide en el panel, aquí solo se ejecuta.
    // Visto bueno (o no) de JJ sobre una solicitud. Es el paso que antes hacía
    // la web sola: hasta aquí el cliente no ha pagado ni tiene cita confirmada.
    if (pathname === '/api/lead-decision' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 1e4) || '{}');
      const rowIndex = parseInt(body.rowIndex, 10);
      const decision = body.decision === 'aprobada' ? 'aprobada' : body.decision === 'rechazada' ? 'rechazada' : null;
      if (!decision || isNaN(rowIndex)) return sendJSON(res, 400, { ok: false, error: 'Decisión no válida.' });
      const { rows } = readLeadsRaw();
      const lead = rows.find(r => r._row === rowIndex);
      if (!lead) return sendJSON(res, 404, { ok: false, error: 'Esa ficha ya no existe.' });
      // Aprobar es dar fecha. Sin fecha no hay nada que confirmar ni que cobrar.
      if (decision === 'aprobada' && !lead.fecha_cita) {
        return sendJSON(res, 400, { ok: false, error: 'sin_fecha' });
      }
      const hoy = new Date();
      const hoyStr = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');
      const ok = updateLeadFields(rowIndex, decision === 'aprobada'
        ? { estado_solicitud: decision, fecha_aprobacion: hoyStr }
        : { estado_solicitud: decision });
      if (!ok) return sendJSON(res, 404, { ok: false, error: 'Esa ficha ya no existe.' });
      sendJSON(res, 200, { ok: true, decision });
      // El aviso al cliente sale solo si dejó email; si no, JJ le escribe por WhatsApp.
      if (lead.email && body.avisar !== false) {
        const m = decision === 'aprobada' ? emailAprobacion(lead, readContent()) : emailNoEncaja(lead);
        sendEmail(lead.email, m.subject, m.html).catch(() => {});
      }
      return;
    }

    if (pathname === '/api/lead-delete' && req.method === 'POST') {
      if (!getSession(req)) return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
      const body = JSON.parse(await readBody(req, 5e5) || '{}');
      const ok = deleteLead(Number(body.rowIndex));
      return sendJSON(res, ok ? 200 : 404, { ok });
    }

    // Importación masiva de contactos (pegados desde Excel/a mano) como leads tipo 'manual'
    if (pathname === '/api/leads-import' && req.method === 'POST') {
      if (!getSession(req)) return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
      const body = JSON.parse(await readBody(req, 3e6) || '{}');
      const rows = Array.isArray(body.rows) ? body.rows : [];
      let count = 0;
      rows.forEach(r => {
        const nombre = (r.nombre || '').trim();
        const email = (r.email || '').trim();
        const whatsapp = (r.whatsapp || '').trim();
        const instagram = (r.instagram || '').trim();
        if (!nombre && !email && !whatsapp && !instagram) return;
        appendLead({
          tipo: 'manual',
          nombre, email, whatsapp, instagram,
          // Fecha real en que escribió la persona (dd/mm/aaaa). Si no se sabe,
          // se deja vacío y el CSV guarda la fecha de hoy como hasta ahora.
          fecha_registro: (r.fecha_contacto || '').trim() || undefined,
          servicio: (r.servicio || '').trim(),
          zona: (r.zona || '').trim(),
          tamano: (r.tamano || '').trim(),
          fianza: (r.fianza || '').trim(),
          estado_fianza: (r.estado_fianza || '').trim(),
          mensaje: r.notas || '',
          fuente: (r.fuente || '').trim() || 'Importado (lista de espera)'
        }, []);
        count++;
      });
      return sendJSON(res, 200, { ok: true, count });
    }

    // Regenerar el enlace del calendario suscribible (por si se ha compartido sin querer)
    if (pathname === '/api/calendar-token/regenerar' && req.method === 'POST') {
      if (!getSession(req)) return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
      const token = regenerateCalendarToken();
      return sendJSON(res, 200, { ok: true, token });
    }

    // Proveedores y colaboraciones — mismo patrón simple (listar / crear / editar)
    const simpleMatch = pathname.match(/^\/api\/(proveedores|colaboraciones|materiales|pedidos|cuentas)(-edit)?$/);
    if (simpleMatch) {
      if (!getSession(req)) return sendJSON(res, 401, { ok: false, error: 'Sesión no iniciada.' });
      const store = SIMPLE_STORES[simpleMatch[1]];
      if (simpleMatch[2] === '-edit' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 5e5) || '{}');
        const ok = updateSimpleCsvRow(store.file, store.header, Number(body.rowIndex), body.fields || {});
        return sendJSON(res, ok ? 200 : 404, { ok });
      }
      if (!simpleMatch[2] && req.method === 'GET') {
        return sendJSON(res, 200, { ok: true, items: readSimpleCsv(store.file, store.header).slice().reverse() });
      }
      if (!simpleMatch[2] && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 5e5) || '{}');
        appendSimpleCsv(store.file, store.header, body);
        return sendJSON(res, 200, { ok: true });
      }
    }

    if (pathname === '/api/content' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 2e6) || '{}');
      // El admin nunca recibe calendarToken (se oculta en el GET público), así que si no
      // viene en lo que guarda, mantenemos el que ya había en vez de borrarlo.
      if (!('calendarToken' in body)) body.calendarToken = readContent().calendarToken;
      writeJSON(CONTENT_FILE, body);
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/upload-photo' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 12e6) || '{}');
      const { slot, listKey, index, filename, dataBase64, field, append } = body;
      if ((!slot && !listKey) || !dataBase64) return sendJSON(res, 400, { ok: false, error: 'Faltan datos.' });
      const ext = (path.extname(filename || '') || '.jpg').toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const outName = 'foto_' + (slot || listKey + '_' + index) + '_' + Date.now() + safeExt;
      const outPath = path.join(UPLOADS_DIR, outName);
      const base64Data = dataBase64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
      const content = readContent();
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
        if (append) {
          const arr = content[listKey][index][field || 'url'];
          content[listKey][index][field || 'url'] = (Array.isArray(arr) ? arr : []).concat(publicPath);
        } else {
          content[listKey][index][field || 'url'] = publicPath;
        }
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
    if (filePath === '/agenda') filePath = '/agenda.html';
    if (filePath === '/academy') filePath = '/academy.html';
    if (filePath === '/legal') filePath = '/legal.html';
    if (filePath === '/certificado') filePath = '/certificado.html';
    if (filePath === '/qr') filePath = '/qr.html';
    if (filePath === '/apertura') filePath = '/apertura.html';
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
  console.log('  → Proveedores:       proveedores.csv');
  console.log('  → Colaboraciones:    colaboraciones.csv');
  console.log('  → Materiales:        materiales.csv');
  console.log('  → Pedidos:           pedidos.csv');
  console.log('  → Cuentas:           cuentas.csv');
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
