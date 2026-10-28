const form = document.getElementById("letter-form");
const textarea = document.querySelector("#letter");
const paper = document.getElementById("paper");
const button = form?.querySelector('button[type="submit"]');
const againButton = document.getElementById("again");
const afterMessage = document.getElementById("after-message");

// ---------- Réglages ----------
const MARGIN_X = 40; // marge du canvas à gauche et à droite du papier (px)
const MARGIN_TOP = 28; // marge au-dessus du papier : reste sous le texte d'intro (32px d'espace)
const MARGIN_BOTTOM = 6; // marge sous le papier
const BURN_DURATION = 5.0; // durée de la montée du feu (secondes)
const HOLE_START = 0.3; // les trous commencent à 20 % de la montée du feu
const HOLE_DURATION = 7; // durée pendant laquelle la cendre se perce et disparaît
const TOTAL_DURATION = BURN_DURATION * HOLE_START + HOLE_DURATION - 1;

let isBurning = false;
let fx = null; // le moteur WebGL, créé une seule fois

// ---------- Les shaders ----------
// Le vertex shader ne fait que couvrir tout le canvas avec un rectangle.
const VERTEX_SHADER = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Le fragment shader est exécuté pour CHAQUE pixel du canvas, à chaque image.
// C'est lui qui calcule le papier qui brûle, les flammes, les braises et les étincelles.
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
 
uniform float uTime;       // temps écoulé depuis le dépôt (secondes)
uniform vec2 uSize;        // taille du papier (px CSS)
uniform vec2 uOffset;      // position du coin bas-gauche du papier dans le canvas
uniform float uTopMargin;  // marge au-dessus du papier
uniform float uDpr;        // densité de pixels de l'écran
uniform float uBurnDur;
uniform float uHoleStart;
uniform float uHoleDur;
uniform sampler2D uTex;    // l'image de la lettre
 
// --- Bruit : la base de tout effet "naturel" ---
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
 
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
 
// On empile plusieurs couches de bruit, de plus en plus fines
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}
 
// Couleur du feu selon sa température : rouge sombre -> orange -> jaune -> blanc chaud
vec3 fireRamp(float v) {
  vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(0.95, 0.25, 0.02), smoothstep(0.0, 0.35, v));
  c = mix(c, vec3(1.0, 0.65, 0.1), smoothstep(0.3, 0.65, v));
  c = mix(c, vec3(1.0, 0.95, 0.7), smoothstep(0.65, 1.0, v));
  return c;
}
 
// Des trous de tailles différentes : on découpe la feuille en cellules,
// et chaque cellule peut contenir un trou (petit, moyen ou grand) qui s'ouvre à son heure.
// Renvoie une distance normalisée : < 1 = dans le trou, 1 = bord du trou.
float holeField(vec2 p, float tSec) {
  vec2 g = p * 3.5;
  vec2 id = floor(g);
  float wob = (fbm(p * 18.0) - 0.5) * 0.25;   // bord irrégulier, déchiré
  float best = 10.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = id + vec2(float(i), float(j));
      float h1 = hash(cell + 1.7);
      float h2 = hash(cell + 5.3);
      float h3 = hash(cell + 9.1);
      float h4 = hash(cell + 13.9);
      vec2 center = cell + vec2(0.2 + 0.6 * h1, 0.2 + 0.6 * h2);
      float exists = step(0.3, h3);                 // 7 cellules sur 10 ont un trou
      float R = exists * mix(0.1, 0.65, h4 * h4);   // la plupart petits, quelques grands
      // Chaque trou s'ouvre quand le feu passe à sa hauteur (+ un petit délai) :
      // les trous se forment donc pendant les flammes, du bas vers le haut
      float asp = uSize.x / uSize.y;
      float cellDist = clamp(length(center / 3.5 - vec2(asp, 0.0)) / length(vec2(asp, 1.0)), 0.0, 1.0);
      float tOpen = ((cellDist + 0.3) / 1.75) * uBurnDur + 0.2 + 0.5 * h1;
      float grow = smoothstep(tOpen, tOpen + 1.3, tSec);
      float Rc = max(R * grow, 0.0001);
      float dist = length(g - center) + wob;
      best = min(best, dist / Rc);
    }
  }
  return best;
}
 
void main() {
  // Coordonnées du pixel, par rapport au papier (uv.y = 0 en bas, 1 en haut)
  vec2 fc = gl_FragCoord.xy / uDpr;
  vec2 pos = fc - uOffset;
  vec2 uv = pos / uSize;
  float aspect = uSize.x / uSize.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
 
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
 
  // ---------- 1. Le front du feu ----------
  // b = "l'heure à laquelle ce pixel brûle" : le bas brûle d'abord,
  // et le bruit rend le front irrégulier, comme un vrai papier.
  // Le feu démarre au coin bas droit (comme avec un briquet) et s'étale en cercle
  vec2 corner = vec2(aspect, 0.0);
  float maxDist = length(vec2(aspect, 1.0));   // distance du coin au coin opposé
  float dist = length(p - corner);
  float nb = fbm(p * 2.6 + 11.0);
  float b = dist / maxDist + (nb - 0.5) * 0.6 + (fbm(p * 9.0 + 3.0) - 0.5) * 0.06;
  float tB = clamp(uTime / uBurnDur, 0.0, 1.0);
  float f = -0.3 + 1.75 * tB;   // position du front
  float e = f - b;              // e < 0 : papier intact / e > 0 : déjà brûlé
 
  // ---------- 2. Le papier ----------
  vec3 paperCol = texture2D(uTex, uv).rgb;
 
  // Il roussit en approchant du front, puis noircit au bord
  float scorch = smoothstep(-0.16, 0.0, e);
  paperCol = mix(paperCol, paperCol * vec3(0.62, 0.38, 0.2), scorch * 0.85);
  paperCol = mix(paperCol, vec3(0.08, 0.05, 0.03), smoothstep(-0.05, 0.0, e));
 
  // Derrière le front, il ne reste que de la cendre noire
  vec3 ashCol = vec3(0.075, 0.068, 0.062) + 0.05 * fbm(p * 20.0);
  float isAsh = smoothstep(0.0, 0.02, e);
  vec3 base = mix(paperCol, ashCol, isAsh);
 
  // ---------- 3. La braise le long du front ----------
  float band = smoothstep(-0.035, 0.0, e) * (1.0 - smoothstep(0.0, 0.08, e));
  float flick = fbm(p * 24.0 + vec2(0.0, -uTime * 1.2));
  float heat = clamp(band * (0.45 + 1.2 * flick), 0.0, 1.0);
  vec3 emissive = fireRamp(heat) * heat * 1.3;
 
  // ---------- 4. La cendre se perce ----------
  float tA = clamp((uTime - uBurnDur * uHoleStart) / uHoleDur, 0.0, 1.0);
  // Les trous s'ouvrent d'abord ; le balayage de bas en haut démarre au quart de la phase
  float sweepT = clamp((tA - 0.25) / 0.75, 0.0, 1.0);
  float thr = sweepT * 0.97 + 0.15 * min(sweepT * 8.0, 1.0);
  // La cendre disparaît dans le même sens que le feu (du coin bas droit vers le coin opposé) :
  // la distance au coin pèse plus que le bruit, qui rend le bord irrégulier
  float nh = (fbm(p * 3.2 + 40.0) * 0.8 + fbm(p * 12.0 + 5.0) * 0.2) * 0.45
           + clamp(dist / maxDist, 0.0, 1.0) * 0.55;
  // Trous de tailles différentes
  float holeD = holeField(p, uTime);
  float holeA = smoothstep(1.0, 1.08, holeD);
 
  // Bords de la feuille de cendre, rongés de façon irrégulière
  float edgePx = min(min(pos.x, uSize.x - pos.x), min(pos.y, uSize.y - pos.y));
  float cutPx = 3.0 + 26.0 * fbm(p * 11.0 + 21.0);
  float edgeKeep = smoothstep(cutPx, cutPx + 2.0, edgePx);
 
  float ashA = smoothstep(thr, thr + 0.02, nh) * holeA * edgeKeep;
 
  // Le bord des trous rougeoie un instant
  float rim = (1.0 - smoothstep(0.0, 0.06, nh - thr)) * step(0.0, nh - thr);
  rim *= step(0.001, sweepT) * (1.0 - 0.5 * sweepT);
  // Le bord de chaque trou rougeoie aussi un instant
  float holeRim = (1.0 - smoothstep(1.0, 1.35, holeD)) * step(1.0, holeD)
                * (1.0 - 0.6 * tA);
  rim = max(rim, holeRim);
  rim *= smoothstep(0.0, 0.03, e);
  float rimHeat = clamp(rim * (0.4 + fbm(p * 30.0 + uTime)), 0.0, 1.0);
  vec3 rimCol = fireRamp(rimHeat) * rim * 1.2;
 
  float aPaper = inside * mix(1.0, ashA, isAsh);
  vec3 paperLayer = base + (emissive + rimCol);
 
  // ---------- 5. Les flammes ----------
  float H = 0.5;                      // hauteur maximale des flammes
  float d = b - f;                    // distance au front (pour la lueur)
 
  // Les flammes montent verticalement au-dessus de l'arc de cercle du front :
  // hv = hauteur du pixel au-dessus de cet arc
  float dx = corner.x - p.x;
  float Rloc = (f - (nb - 0.5) * 0.6) * maxDist;
  float onArc = step(dx, Rloc) * step(0.0, Rloc);
  float arcY = sqrt(max(Rloc * Rloc - dx * dx, 0.0));
  float hv = mix(-1.0, p.y - arcY, onArc);
  float hh = (hv + 0.05) / H;         // 0 à la base de la flamme, 1 à sa pointe
  float hc = clamp(hh, 0.0, 1.0);
  float timeFade = smoothstep(0.0, 0.8, uTime);
  // Flammes, étincelles et lueur restent dans les limites du papier :
  // rien ne démarre sous le bord bas (là où se trouve le bouton) ni sur les côtés
  float sideFade = smoothstep(-0.05, 0.05, uv.x) * (1.0 - smoothstep(1.0, 1.03, uv.x))
                 * smoothstep(0.0, 0.03, uv.y);
  // Les flammes s'éteignent en douceur juste avant le haut du papier
  float topFade = 1.0 - smoothstep(uSize.y - 50.0, uSize.y + uTopMargin * 0.9, pos.y);
 
  float flame = 0.0;
  if (hh > 0.0 && hh < 1.0) {
    // Le motif de bruit monte avec le temps, et on le déforme pour faire vaciller
    vec2 q = vec2(p.x * 3.5, p.y * 2.4 - uTime * 2.2);
    q.x += (fbm(q * 1.4 + 3.0) - 0.5) * 1.1;
    float n1 = fbm(q);
    flame = n1 * 1.7 - hh * 1.15;     // plus on monte, plus la flamme s'éteint
    flame = smoothstep(0.1, 0.85, flame);
  }
  flame *= timeFade * sideFade * topFade;
 
  float fa = smoothstep(0.03, 0.4, flame);
  vec3 fcol = fireRamp(clamp(flame * (0.95 + (1.0 - hc) * 0.3), 0.0, 1.0));
 
  // ---------- 6. Les étincelles ----------
  float hs = hh;
  vec2 sg = vec2(p.x * 26.0, p.y * 16.0 - uTime * 2.5);
  vec2 sid = floor(sg);
  vec2 sf = fract(sg);
  float sr = hash(sid + 7.0);
  vec2 sjit = vec2(hash(sid + 3.1), hash(sid + 9.7));
  float spark = step(0.955, sr) * (1.0 - smoothstep(0.0, 0.09, length(sf - sjit)));
  spark *= step(0.2, hs) * (1.0 - smoothstep(1.0, 2.4, hs));
  spark *= 0.5 + 0.5 * sin(uTime * 8.0 + sr * 40.0);
  spark *= timeFade * sideFade * topFade;
  fcol = mix(fcol, vec3(1.0, 0.75, 0.3), spark);
  fa = max(fa, spark);
 
  // ---------- 7. Une lueur autour du front ----------
  float halo = 0.18 * exp(-abs(d) * 5.0) * timeFade * sideFade * topFade;
 
  // ---------- Assemblage : halo, puis papier, puis flammes par-dessus ----------
  vec3 premult = vec3(1.0, 0.4, 0.08) * halo;
  float a = halo;
 
  premult = paperLayer * aPaper + premult * (1.0 - aPaper);
  a = aPaper + a * (1.0 - aPaper);
 
  premult = fcol * fa * 1.2 + premult * (1.0 - fa);
  a = fa + a * (1.0 - fa);
 
  gl_FragColor = vec4(clamp(premult / max(a, 0.001), 0.0, 1.0), a);
}
`;

// ---------- Mise en place de WebGL ----------
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Erreur de shader :", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function createFx() {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "5";
  canvas.style.display = "none";

  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Erreur d'édition de liens :", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  // Un rectangle qui couvre tout le canvas
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // La texture qui contiendra l'image de la lettre
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const names = [
    "uTime",
    "uSize",
    "uOffset",
    "uTopMargin",
    "uDpr",
    "uBurnDur",
    "uHoleStart",
    "uHoleDur",
    "uTex",
  ];
  const loc = {};
  names.forEach(function (name) {
    loc[name] = gl.getUniformLocation(program, name);
  });

  return { canvas, gl, loc, texture };
}

// ---------- La lettre, dessinée sur une image ----------
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  text.split("\n").forEach(function (paragraph) {
    if (paragraph === "") {
      lines.push("");
      return;
    }
    let line = "";
    paragraph.split(" ").forEach(function (word) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    lines.push(line);
  });
  return lines;
}

function drawLetter(text, width, height, dpr) {
  const c = document.createElement("canvas");
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);

  // Le papier, avec un léger grain
  ctx.fillStyle = "#f3ecdf";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = "rgba(120, 90, 50, " + Math.random() * 0.05 + ")";
    ctx.fillRect(
      Math.random() * width,
      Math.random() * height,
      1 + Math.random() * 2,
      1 + Math.random() * 2
    );
  }

  // Le texte, avec la même police que le textarea
  const cs = getComputedStyle(textarea);
  const fontSize = parseFloat(cs.fontSize);
  const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.8;
  const padLeft = parseFloat(cs.paddingLeft);
  const padRight = parseFloat(cs.paddingRight);
  const padTop = parseFloat(cs.paddingTop);

  ctx.font = fontSize + "px " + cs.fontFamily;
  ctx.fillStyle = "#2b2733";
  ctx.textBaseline = "top";

  const lines = wrapText(ctx, text, width - padLeft - padRight);
  lines.forEach(function (line, i) {
    ctx.fillText(
      line,
      padLeft,
      padTop + i * lineHeight + (lineHeight - fontSize) / 2
    );
  });

  return c;
}

// ---------- Le déroulement ----------
function startBurn() {
  fx = fx || createFx();
  if (!fx) {
    // WebGL indisponible : on fait simplement disparaître la lettre
    textarea.value = "";
    return;
  }

  const { canvas, gl, loc, texture } = fx;
  const width = textarea.offsetWidth;
  const height = textarea.offsetHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Taille et position du canvas : un peu plus grand que le papier
  const cssW = width + 2 * MARGIN_X;
  const cssH = height + MARGIN_TOP + MARGIN_BOTTOM;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.style.left = -MARGIN_X + "px";
  canvas.style.top = -MARGIN_TOP + "px";
  paper.appendChild(canvas);
  gl.viewport(0, 0, canvas.width, canvas.height);

  // La lettre devient une texture
  const letterImage = drawLetter(textarea.value, width, height, dpr);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    letterImage
  );

  gl.uniform2f(loc.uSize, width, height);
  gl.uniform2f(loc.uOffset, MARGIN_X, MARGIN_BOTTOM);
  gl.uniform1f(loc.uTopMargin, MARGIN_TOP);
  gl.uniform1f(loc.uDpr, canvas.width / cssW);
  gl.uniform1f(loc.uBurnDur, BURN_DURATION);
  gl.uniform1f(loc.uHoleStart, HOLE_START);
  gl.uniform1f(loc.uHoleDur, HOLE_DURATION);
  gl.uniform1i(loc.uTex, 0);

  // Première image dessinée AVANT de cacher le textarea, pour éviter un clignotement
  gl.uniform1f(loc.uTime, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  canvas.style.display = "block";
  textarea.style.visibility = "hidden";

  const start = performance.now();
  function frame(now) {
    const t = Math.max(0, (now - start) / 1000);
    gl.uniform1f(loc.uTime, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (t < TOTAL_DURATION) {
      requestAnimationFrame(frame);
    } else {
      finishBurn();
    }
  }
  requestAnimationFrame(frame);
}

function finishBurn() {
  fx.canvas.style.display = "none";
  textarea.value = "";
  textarea.style.visibility = "hidden"; // la zone de texte ne revient pas
  if (button) button.style.visibility = "hidden"; // le bouton disparaît aussi
  afterMessage?.classList.add("visible"); // seul le message apparaît, en fondu
  isBurning = false;
}

// Pour écrire une autre lettre, sans recharger la page
againButton?.addEventListener("click", function () {
  afterMessage?.classList.remove("visible");
  textarea.style.visibility = "visible";
  textarea.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 1200,
    easing: "ease-out",
  });
  if (button) {
    button.style.visibility = "visible";
    button.disabled = false;
  }
  textarea.focus();
});

form?.addEventListener("submit", function (event) {
  event.preventDefault();

  // On ignore le clic si le feu est déjà en cours ou si la lettre est vide
  if (isBurning) return;
  if (!textarea?.value.trim()) return;

  isBurning = true;
  afterMessage?.classList.remove("visible"); // il disparaît quand on dépose une nouvelle lettre
  if (button) button.disabled = true;
  textarea.blur();
  startBurn();
});
