SACRAVM — TU WEB, EN LENGUAJE SENCILLO
═══════════════════════════════════════════════════════════════════

QUÉ HAY EN ESTA CARPETA
────────────────────────
- index.html       → tu web pública (lo que ven los clientes)
- admin.html        → tu panel de administración (como WordPress)
- server.js         → el "motor" que hace funcionar todo
- START.command     → doble clic aquí para encenderlo todo
- content.json       → se crea solo. Aquí vive todo tu contenido
- credentials.json   → se crea solo. Tu usuario y contraseña (guardados de forma segura)
- uploads/           → se crea solo. Aquí se guardan las fotos que subas
- leads/leads.csv    → se crea solo. AQUÍ APARECEN TODAS TUS RESERVAS Y LEADS


1. CÓMO ENCENDER TU WEB
──────────────────────────
Doble clic en START.command
(la primera vez, si macOS avisa de "desarrollador no identificado":
clic derecho sobre el archivo → Abrir → Abrir)

Se abre tu navegador en la web pública. Pruébala: clica "RESERVAR CITA"
y rellena el asistente de 4 pasos como si fueras un cliente.

Para apagarlo, cierra la ventana de terminal que se abrió.


2. TU PANEL DE ADMINISTRACIÓN (como WordPress)
─────────────────────────────────────────────────
Con el servidor encendido, ve a:

        http://localhost:3000/admin

LA PRIMERA VEZ te pedirá crear tu cuenta: eliges un usuario y una
contraseña (mínimo 6 caracteres). Guárdalos bien — es la única vez
que se crea la cuenta. Las próximas veces solo inicias sesión.

Desde el panel puedes cambiar, sin tocar ningún código:
  - Datos básicos: nombre, ciudad, email, WhatsApp, Instagram
  - Horarios disponibles para las citas
  - Servicios y precios (añadir, editar o borrar)
  - Fotos: las subes directamente desde tu ordenador o móvil,
    arrastrando el archivo — nada de imgur ni enlaces
  - Testimonios
  - Ver todos tus leads (reservas y lista de espera) en una tabla
  - Cambiar tu contraseña cuando quieras

Después de cualquier cambio, pulsa "GUARDAR CAMBIOS" (abajo a la
derecha). Los cambios se ven al momento en tu web pública — solo
recarga la página.

Las fotos se guardan al momento en cuanto las subes, no hace falta
pulsar "Guardar cambios" para ellas.


3. DÓNDE ESTÁN TUS LEADS
──────────────────────────
Dos formas de verlos:
  a) Panel de administración → pestaña "Leads" → tabla con todo
  b) Carpeta "leads" → archivo leads.csv → doble clic, se abre en
     Excel o Numbers

Ese archivo se queda siempre en tu ordenador, en esta misma carpeta.


4. SEGURIDAD DE TU CONTRASEÑA
────────────────────────────────
Tu contraseña se guarda cifrada (no en texto plano) en credentials.json,
con un método estándar y seguro (scrypt). Aun así, esto es un panel
pensado para uso local o de un solo administrador — si más adelante
publicas la web en internet, usa un hosting con HTTPS (ver punto 5)
para que la conexión también viaje cifrada.


5. CUANDO QUIERAS PUBLICARLA EN INTERNET (para que la vean tus clientes)
───────────────────────────────────────────────────────────────────────
Ahora mismo la web solo funciona en tu ordenador (localhost). Para que
cualquier persona pueda entrar desde su móvil, reservar cita y para que
tú puedas entrar a /admin desde cualquier sitio, esta carpeta completa
hay que subirla a un hosting que soporte Node.js. Dos opciones sencillas
y gratuitas para empezar:

  - Render.com  → "New Web Service", conecta esta carpeta, comando de
                  arranque: node server.js
  - Railway.app → mismo proceso, muy parecido

Cuando la tengas publicada ahí, escríbeme y te ayudo a dejarla lista.
El diseño, el asistente de reserva y el panel de administración no
cambian — solo el sitio donde vive.


IMPORTANTE — CÓMO EDITAR ARCHIVOS SI ALGUNA VEZ LO NECESITAS
────────────────────────────────────────────────────────────
Ya no necesitas tocar index.html para cambiar texto o fotos — usa el
panel /admin. Pero si algún día necesitas abrir un archivo de código
(por ejemplo porque me pides un cambio de diseño), NUNCA lo abras con
doble clic en TextEdit sin más: TextEdit puede guardarlo como texto
enriquecido y romper la web. Si tienes que editar código, usa Visual
Studio Code (gratis, en code.visualstudio.com) o pídemelo a mí.


DUDAS
──────
Si algo no se ve bien o quieres una función nueva en el panel,
vuelve a pedírmelo y lo ajusto.
