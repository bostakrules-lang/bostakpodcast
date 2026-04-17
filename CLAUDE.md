# Auto Reels — Biohack-it

Convierte un podcast 16:9 en 12 reels 9:16 pulidos y listos para Instagram/TikTok/YouTube Shorts.

## Dónde está todo

El proyecto Remotion vive en `rf/` dentro de esta misma carpeta.

```
rf/
├── src/Reel/                ← Componentes TSX (HookTitle, Subtitles, BiohackLogo, CTAOverlay)
├── scripts/                 ← Scripts Node (download, transcribe, select-clips, cut-clips, render-reels)
├── public/                  ← Assets de marca (overlay PNG, avatar, música, SFX)
│   ├── biohack-overlay.png
│   ├── cta/biohack-avatar.jpg
│   ├── sfx/click.mp3
│   └── music/track1.mp3, track2.mp3, track3.mp3
├── whisper.cpp/             ← Whisper.cpp compilado + modelo medium.en (NO instalar nada)
├── node_modules/            ← Dependencias Node pre-instaladas (NO hacer npm install)
└── episodes/<slug>/         ← Episodios procesados
```

### Scripts Python (bundled)

Los scripts Python del pipeline están en `rf/scripts-python/`. Cópialos al directorio de trabajo antes de ejecutar:
- `reframe_clips.py` — reencuadre 16:9→9:16 con face-tracking
- `classify_shots.py` — clasificación de planos de cámara
- `qa_faces.py` — QA de detección de caras post-render
- `analyze_climax.py` — análisis de picos de energía musical

### Setup por sesión

1. `cd rf` (trabajar dentro del proyecto Remotion)
2. `pip install opencv-python-headless --break-system-packages` (~10s, lo único que no persiste)
3. Listo. NO hacer `npm install`. NO descargar modelos whisper. Ya está todo.

## Pipeline completo (11 pasos)

Cuando Albert dice "procesa este episodio" o da un video, ejecutar TODO sin parar a preguntar:

### Paso 1 — Ingestar video

Si da URL de Drive/Dropbox:
```bash
cd rf && node scripts/download.mjs "<url>" --slug "<slug>"
```

Si da archivo local:
```bash
mkdir -p rf/episodes/<slug>
cp /path/to/video.mp4 rf/episodes/<slug>/source.mp4
echo '{"slug":"<slug>","title":"<title>"}' > rf/episodes/<slug>/meta.json
```

### Paso 2 — Transcribir episodio

```bash
cd rf && node scripts/transcribe.mjs episodes/<slug>
```
Produce `transcript.json` y `transcript.srt`. Usa Whisper.cpp (medium.en) — ya compilado en `whisper.cpp/`.

### Paso 3 — Seleccionar 12 clips virales

```bash
cd rf && node scripts/select-clips.mjs episodes/<slug>
```
Claude analiza el SRT y elige 12 momentos. Output: `clips.json`.

Prompt de selección (estilo DOAC):
- 12 reels, 25-75 segundos cada uno
- Hook: MAYÚSCULAS, max 40 chars, punchy, curiosity-driving
- Mix de formatos: myth busts, bold statements, questions, personal admissions
- Priorizar: declaraciones contrarian, admisiones personales, mitos desafiados, analogías fuertes
- Evitar: segmentos planos, ad reads, intros, small talk

### Paso 4 — Clasificar planos de cámara

```bash
cp rf/scripts-python/classify_shots.py .
python3 classify_shots.py rf/episodes/<slug>
```
Detecta TIGHT_SINGLE / SIDE_BY_SIDE / WIDE_2SHOT / BROLL con posición de cara. Output: `shots.json`.

### Paso 5 — Reencuadrar 16:9 → 9:16

```bash
cp rf/scripts-python/reframe_clips.py .
python3 reframe_clips.py 1
python3 reframe_clips.py 2
# ... hasta 12, uno por uno
```

El script aplica automáticamente:
- **enforce_intro_tight** — primer plano siempre individual del hablante
- **close_gaps** — sin frames negros entre segmentos
- **fix_bad_cx** — corrige crops descuadrados (umbral 0.08 del mediana). NO TOCA segmentos _forced ni _bridge.
- **absorb_micro_segments** — fusiona segmentos <2s
- **merge_redundant** — colapsa cortes imperceptibles (tolerancia cx 0.040). NO MERGEA entre boundaries de source diferente.
- **insert_host_bridge** — cutaway de 1.3s del host ESCUCHANDO (boca cerrada, SIDE_BY_SIDE) cuando hay transición de cámara
- Usa **concat** (NO xfade) para clips con bridge — xfade congela frames
- Bridge extraction: `-ss` DESPUÉS de `-i` (frame-accurate). Antes = keyframe = frame congelado.

### Paso 6 — Captions word-level

```bash
cd rf && node scripts/transcribe-clips.mjs episodes/<slug>
```

### Paso 7 — Música

```bash
cp rf/scripts-python/analyze_climax.py .
python3 analyze_climax.py
```

Datos de los 3 tracks (ya analizados):
| Track | Pico energía | musicStartSec | Vol | Carácter |
|-------|-------------|---------------|-----|----------|
| track1.mp3 | 29.5s (-8.4 LUFS) | 21.5 | 0.18 | Energético |
| track2.mp3 | 67.6s (-5.9 LUFS) | 59.6 | 0.15 | El más fuerte |
| track3.mp3 | 38.6s (-16.5 LUFS) | 30.6 | 0.18 | Ambient/calmo |

Actualizar `clips.json`:
- Rotar tracks sin repetir consecutivos
- `musicStartSec` = pico de energía - 8 segundos
- `musicVolume` = 0.15-0.18 (tracks más fuertes → volumen más bajo)

### Paso 8 — Renderizar con Remotion

Renderizar **uno por uno**, limpiando temp entre renders:
```bash
rm -rf /tmp/remotion-* /tmp/react-motion-*
npx remotion render Reel "output/<slug>/reel-XX.mp4" --props="<props.json>" --concurrency=2
```

Props por reel:
```json
{
  "src": "clips/<slug>/clip-XX.mp4",
  "hook": "HOOK TEXT AQUÍ",
  "music": "music/trackN.mp3",
  "musicVolume": 0.18,
  "musicStartSec": 21.5,
  "cta": {"handle": "@biohack-it", "tagline": "follow for more", "durationSec": 3}
}
```

### Paso 9 — QA automático

```bash
cp rf/scripts-python/qa_faces.py .
python3 qa_faces.py output/<slug>/reel-XX.mp4
```

Interpretación de fallos:
- SIDE_BY_SIDE con caras pequeñas → falso negativo (ignorar)
- Mano en la cara / ojos cerrados → falso negativo (ignorar)
- Cortinas/muebles/sofá sin persona → **PROBLEMA REAL** → necesita fix

Para verificar: `ffmpeg -ss <timestamp> -i <reel> -frames:v 1 -q:v 3 frame_check.jpg`

### Paso 10 — Auto-fix

1. cx descuadrado → re-ejecutar paso 5 + 8 para ese clip
2. Persona se mueve durante segmento largo → dividir segmento y re-detectar
3. Irrecuperable → insertar host bridge en el punto problemático

Máximo 2 iteraciones de fix. Si sigue fallando → marcar para revisión manual.

### Paso 11 — Puntuar y entregar

Puntuación de viralidad (1-100):
```
PUNTUACIÓN = (hook_score × 0.35) + (qa_score × 0.25) + (duration_score × 0.20) + (content_score × 0.20)
```

Entregar:
1. Copiar los 12 reels a la carpeta del usuario
2. Tabla resumen con hook, duración, música, QA, score, notas
3. Recomendar top 5 para publicar primero
4. Sugerir orden de publicación (variedad de temas)

## Specs visuales del reel (Biohack-it brand)

Cada reel tiene estas capas, de atrás hacia delante:

### 1. Video de fondo
- 1080x1920 (9:16), 30fps
- `object-fit: cover` — el clip reencuadrado llena toda la pantalla

### 2. Overlay de marca (BiohackLogo)
- PNG transparente (`public/biohack-overlay.png`) proporcionado por Albert
- Contiene: degradado rojo en la parte inferior + wordmark "Biohack-it" serif blanco centrado abajo
- Se superpone a CADA frame al 100% del tamaño

### 3. Hook title (primeros ~2.3s)
- **Fuente**: Helvetica Neue, weight 900 (extra bold), fallback: Nimbus Sans → Arial Black
- **Tamaño**: 92px
- **Color**: BLANCO puro (#FFFFFF)
- **Sombra texto normal**: `0 3px 6px rgba(0,0,0,0.95), 0 6px 16px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,1)`
- **Todo en MAYÚSCULAS**, letter-spacing -1px
- **Posición**: centrado horizontal, ligeramente debajo del centro vertical (~56% desde arriba, paddingTop 220px)
- **Palabra clave** (la más larga o la indicada en `hookHighlight`):
  - Caja roja (#E01621) que DESLIZA de izquierda a derecha (slide-in, 16 frames empezando en frame 6)
  - Texto blanco SIN sombra sobre la caja roja
  - Padding: 4px 20px 10px 20px
- **Animación entrada**: spring (damping 16, stiffness 140, mass 0.65), translateY de 36→0
- **Duración**: 2s hold + 0.35s fade out
- **Layout**: 1-2 líneas, auto-balanced por longitud (~16 chars max por línea)
- **Max ancho**: 90% del frame

### 4. Subtítulos (karaoke word-by-word)
- **Fuente**: Helvetica Neue, weight 800, fallback: Nimbus Sans → Arial Black
- **Tamaño**: 48px
- **Color**: BLANCO (#FFFFFF), todo MAYÚSCULAS
- **Sombra** (no stroke): `0 2px 4px rgba(0,0,0,0.85), 0 4px 14px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.9)`
- **Posición**: bottom-center, paddingBottom 560px (zona media-baja, por encima del wordmark)
- **Max ancho**: 82%
- **Agrupación**: ~1200ms por "página" (3-5 palabras por grupo)
- **Ocultos durante**: primeros 2.4s (hook) y últimos 3s (CTA)
- **Corte seco** entre páginas (no fade/slide entre frases)
- **Cola**: 220ms extra después del último token para que se pueda leer

### 5. Música de fondo
- **Volumen**: 0.15-0.18 (configurable por clip en `musicVolume`)
- **Inicio**: `musicStartSec` (calculado: pico de energía - 8s)
- **Tipo**: loops/ambient, 3 tracks disponibles, se rotan sin repetir consecutivos

### 6. CTA overlay (últimos 3s)
- **Degradado inferior**: gradiente negro 0→55% opacity, cubre 45% inferior
- **Tagline** ("follow for more"): Helvetica Neue 500, 30px, letter-spacing 10px, MAYÚSCULAS, blanco 85% opacity, bottom 620px
- **Pill botón**: fondo blanco (#fff), texto negro (#111), border-radius full, padding 32px 72px
  - Contiene: avatar circular (64px) de biohack-it + "@biohack-it" en Helvetica Neue 600 52px
  - Sombra: `0 18px 54px rgba(0,0,0,0.55)`
  - Posición: centrado, bottom 460px
- **Cursor macOS**: SVG flecha blanca con borde negro, 72px
  - Entra desde arriba-derecha (1.0→1.8s)
  - Tap animado a los 2.0s: cursor dip + pill invierte colores (blanco→negro/negro→blanco)
  - SFX click opcional (`sfx/click.mp3`) a los 2.05s
- **Animación secuencia**: pill sube (0→0.55s) → tagline fade in (0.7→1.2s) → cursor entra (1.0→1.8s) → tap (2.0→2.5s)

### Fuente principal
**Helvetica Neue** — elegida desde el inicio, usada en todos los componentes. En headless Linux se resuelve a **Nimbus Sans** (clon open-source métricamente idéntico). Stack completo:
```
"Helvetica Neue", "HelveticaNeue", Helvetica, "Nimbus Sans", "Arial Black", Arial, sans-serif
```

## Reglas críticas (de producción real)

1. **Bridge extraction**: `-ss` DESPUÉS de `-i` (frame-accurate). Antes = keyframe = frame congelado.
2. **Bridge joining**: SIEMPRE `concat`, nunca `xfade` para clips con bridge.
3. **No tocar cx de segmentos _forced**: Su cx es intencional para la geometría SIDE_BY_SIDE.
4. **No mergear entre boundaries de source**: Segmento forzado + normal = geometría diferente.
5. **Limpiar /tmp/remotion-*** entre renders — 500MB por render.
6. **Host bridge**: Usar SIDE_BY_SIDE donde host ESCUCHA (boca cerrada). No TIGHT_SINGLE donde HABLA.
7. **Música**: Volumen 0.15-0.18. La voz siempre domina.
8. **QA antes de entregar**: Todo reel pasa face QA. Pipeline automático = 85%. El 15% restante necesita QA→fix→re-render.
