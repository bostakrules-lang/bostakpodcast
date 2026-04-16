# Biohack-it Reel Factory

Fábrica automática de 12 reels virales por episodio. Un comando, 12 reels.

**Stack:** Remotion (render) + Whisper.cpp (subtítulos) + Claude API (selección editorial DOAC).

---

## Instalación (solo 1 vez)

1. Instala Node 20+ y ffmpeg en tu equipo. ffmpeg: `brew install ffmpeg` (Mac) o descarga desde ffmpeg.org.
2. Instala Python y `gdown` para descargar de Drive:
   ```
   pip install gdown
   ```
3. En la carpeta del proyecto:
   ```
   npm install
   cp .env.example .env
   ```
4. Abre `.env` y pega tu `ANTHROPIC_API_KEY` (la sacas de https://console.anthropic.com/settings/keys).
5. Copia el logo **Biohack-it** como `public/biohack-logo.png` (PNG transparente, ~200px de alto).
6. Copia la **B** decorativa (opcional) como `public/biohack-b.png`.
7. Pon tus **canciones de fondo** en `public/music/` (.mp3/.wav/.m4a). El pipeline las rota entre los 12 reels.

---

## Uso diario (cada episodio nuevo)

```
npm run reels "https://drive.google.com/drive/folders/XXXX"
```

Eso es todo. El pipeline:

1. Descarga el archivo **No Ads** de la carpeta de Drive.
2. Transcribe el episodio con Whisper `medium.en` (ortografía inglés excelente).
3. Llama a Claude con tu prompt DOAC oficial → devuelve 12 clips con hook + score.
4. Corta cada clip y reencuadra a 9:16 (crop centro desde 16:9).
5. Transcribe cada clip palabra a palabra para los subs karaoke.
6. Renderiza los 12 reels en `output/<episodio>/reel-01.mp4` … `reel-12.mp4`.

### Si Drive te da "Too many users downloaded"

Pasa con archivos populares. Abre la carpeta en tu navegador, haz **Archivo > Hacer una copia**, comparte la copia, y usa ese nuevo link.

### Comandos sueltos (debug / re-ejecutar un paso)

```
npm run download "<url>"
npm run transcribe episodes/<slug>
npm run select episodes/<slug>
npm run cut episodes/<slug>
npm run captions episodes/<slug>
npm run render episodes/<slug>
```

Idempotentes: si ya existe transcript/clips, se saltan. Arregla un hook y relanza sin repetir Whisper.

### Preview en Remotion Studio

```
npm run dev
```

Abre http://localhost:3000 y juega con el estilo en vivo.

---

## Estructura

```
reel-factory/
├─ src/Reel/              ← Composition Remotion (hook rojo, subs, logo, B watermark)
│   ├─ index.tsx          ← composition "Reel"
│   ├─ HookTitle.tsx      ← box rojo degradado
│   ├─ Subtitles.tsx      ← karaoke word-by-word blanco outline negro
│   └─ BiohackLogo.tsx    ← wordmark + B decorativa
├─ scripts/               ← pipeline
├─ episodes/<slug>/       ← trabajo por episodio
├─ public/
│   ├─ biohack-logo.png   ← tu logo
│   ├─ music/*.mp3        ← canciones de fondo
│   └─ clips/<slug>/      ← clips cortados
└─ output/<slug>/         ← 12 reels finales 🎉
```

---

## Personalización

- **Color/gradiente hook** → `src/Reel/HookTitle.tsx`
- **Tamaño/posición subs** → `src/Reel/Subtitles.tsx`
- **Volumen música** → `scripts/render-reels.mjs` (campo `musicVolume`, 0.15 por defecto)
- **Modelo Whisper** → `whisper-config.mjs` (`medium.en` sweet spot; `large-v3-turbo` más preciso)
- **Prompt de selección** → `scripts/select-clips.mjs` (`SYSTEM_PROMPT`)

---

## Troubleshooting

| Problema | Solución |
|---|---|
| `Missing ANTHROPIC_API_KEY` | Añádelo a `.env` |
| Whisper muy lento | Cambia a `small.en` en `whisper-config.mjs` |
| Subs mal escritas | Añade reemplazos en `scripts/transcribe-clips.mjs` → `postFix` |
| Música tapa voz | Baja `musicVolume` en `render-reels.mjs` |
