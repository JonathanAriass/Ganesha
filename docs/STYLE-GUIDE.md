# Guía de estilos

Sistema visual de Ganesha, escrito para reutilizarlo en otros proyectos. Está pensado para
aplicaciones de trabajo densas (clientes de bases de datos, paneles, herramientas internas),
de escritorio o web. Todo se apoya en variables CSS: copia el bloque de tokens del final y
construye encima.

## 1. Principios

1. **Todo es un panel.** Cada región de la pantalla (navegación, editor, resultados, panel
   lateral) es una superficie propia, con borde fino y esquinas redondeadas, sobre un lienzo
   más oscuro. Nada va de borde a borde de la ventana.
2. **Pocas líneas.** El borde es del panel. Dentro de un panel, las zonas se distinguen por el
   relleno, no por rayas: nada de separadores entre filas, ni bajo las cabeceras, ni alrededor
   de tarjetas, insignias o botones secundarios.
3. **Un solo hueco.** La separación entre paneles es siempre la misma (`--panel-gap`), y el
   margen del contenido también (`--pad-x`). Dos paneles vecinos nunca suman márgenes.
4. **El color significa algo.** El acento marca la acción principal y lo seleccionado. Verde,
   ámbar y rojo son estados. El color de un elemento del usuario (una conexión, un proyecto)
   se muestra como un punto, no como una franja ni un fondo.
5. **Lo básico primero.** Lo que casi todo el mundo necesita va a la vista; lo demás, en una
   pestaña o detrás de un botón, con una nota visible de lo que hay configurado allí.
6. **Dos densidades, mismos componentes.** Cómoda y compacta cambian solo los tokens de
   tamaño; ningún componente tiene estilos propios por densidad.

## 2. Color

### Superficies

Cuatro niveles, del fondo hacia el usuario. Cada nivel es un paso más claro en tema oscuro.

| Token | Uso | Midnight (oscuro) | Light |
|---|---|---|---|
| `--canvas` | Fondo de la ventana, visible en los huecos entre paneles | derivado de `--bg` | derivado de `--bg` |
| `--bg` | Superficie hundida dentro de un panel (tarjetas, secciones de formulario, detalle) | `#0f1117` | `#f7f8fa` |
| `--bg-2` | Fondo de los paneles y de los diálogos | `#13161f` | `#ffffff` |
| `--bg-3` | Controles (campos, botones), elemento activo de un grupo | `#1b1f2c` | `#eef0f4` |

`--canvas` y `--panel-border` no se eligen a mano: se derivan, así que cualquier tema nuevo
los obtiene gratis.

```css
--canvas: light-dark(color-mix(in srgb, var(--bg) 92%, #000), color-mix(in srgb, var(--bg) 62%, #000));
--panel-border: light-dark(color-mix(in srgb, var(--border) 78%, #000), color-mix(in srgb, var(--border) 70%, #fff));
```

### Texto, acento y estados

| Token | Uso | Midnight | Light |
|---|---|---|---|
| `--text` | Texto principal | `#e3e7f0` | `#1b2230` |
| `--text-2` | Texto secundario, etiquetas, ayudas | `#8b93a7` | `#5b6577` |
| `--border` | Base de los bordes | `#232838` | `#d9dde6` |
| `--accent` | Acción principal, selección, foco | `#6366f1` | `#4f46e5` |
| `--accent-hover` | Acento al pasar el ratón | `#7577f3` | `#4338ca` |
| `--ok` | Correcto, en marcha | `#22c55e` | `#16a34a` |
| `--warn` | Aviso | `#fbbf24` | `#b45309` |
| `--danger` | Acción destructiva (fondo o borde) | `#ef4444` | `#dc2626` |
| `--danger-text` | Texto de error | `#fca5a5` | `#b91c1c` |
| `--hover-overlay` | Capa de hover sobre cualquier superficie | `rgba(255,255,255,.1)` | `rgba(0,0,0,.08)` |

Reglas:

- **Tintes, no colores nuevos.** Un fondo de estado es el color mezclado con transparente:
  `color-mix(in srgb, var(--accent) 16%, transparent)` para la fila seleccionada, 12 % de
  `--ok` o `--danger-text` para mensajes, 18 % de acento para una insignia.
- **Hover sin color propio.** Se usa `--hover-overlay`, que funciona sobre cualquier nivel.
- **Paleta para elementos del usuario** (seis tonos): `#6366f1`, `#ec4899`, `#f59e0b`,
  `#10b981`, `#06b6d4`, `#8b5cf6`. Se pintan como punto de 10 px (8 px en pestañas).
- **Temas.** Un tema redefine solo los tokens de color bajo `:root[data-theme='…']` y declara
  `color-scheme`. Ganesha trae Midnight, Light, Dracula, Nord, Tokyo Night, Catppuccin
  (Mocha y Latte), Gruvbox, Rosé Pine y Solarized Light con este mismo esquema.

## 3. Tipografía

- **Familia:** la del sistema, `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
  Monoespaciada para código, datos y direcciones: `ui-monospace, 'SF Mono', 'Fira Mono', monospace`.
- **Interlineado:** 1.5 en texto, 1.45 en ayudas de una o dos líneas.

| Token | Cómoda | Compacta | Uso |
|---|---|---|---|
| `--fs-base` | 14px | 13px | Texto, títulos de panel |
| `--fs-sm` | 13px | 12px | Controles, etiquetas de campo, filas |
| `--fs-xs` | 12px | 11px | Ayudas, contadores, insignias |

- **Pesos:** 400 normal, 500 para nombres y elemento activo, 600 para títulos.
- **Etiquetas de campo:** en minúsculas normales, `--fs-sm`, peso 500.
- **Títulos de sección:** 11 px, mayúsculas, peso 600, `letter-spacing: 0.06em`, color
  `--text-2`. Es el único sitio donde se usan mayúsculas.
- **Contadores:** número suelto en `--text-2` junto al título, sin píldora. Se omite si es 0.

## 4. Espaciado, radios y tamaños

| Token | Cómoda | Compacta | Uso |
|---|---|---|---|
| `--panel-gap` | 10px | 6px | Hueco entre paneles y entre secciones de un formulario |
| `--pad-x` | 24px | 12px | Margen del contenido respecto a la ventana |
| `--gap` | 8px | 6px | Separación entre controles vecinos |
| `--control-h` | 36px | 28px | Altura de campos, botones de barra, pestañas |
| `--row-h` | 36px | 28px | Altura de fila de lista |
| `--grid-row-h` | 40px | 26px | Altura de fila de tabla de datos |
| `--radius-lg` | 14px | 9px | Paneles y diálogos |
| `--radius-md` | 9px | 7px | Controles, tarjetas, secciones |
| `--statusbar-h` | 32px | 26px | Barra inferior |

- Un elemento dentro de un contenedor redondeado usa un radio 2 px menor que el del
  contenedor: `calc(var(--radius-md) - 2px)`.
- Relleno interior habitual: 8 px en paneles de lista, 12–14 px en secciones de formulario,
  20 px en los lados de un diálogo.
- La densidad se activa con `data-density="compact"` en `:root`.

## 5. Estructura de la pantalla

```
┌──────────┐ ┌───────────────────────────┐ ┌──────────┐
│          │ │ pestañas                  │ │          │
│ lateral  │ ├───────────────────────────┤ │  panel   │
│          │ │ contenido (uno o varios   │ │ acoplado │
│          │ │ paneles, un hueco entre   │ │          │
│          │ │ ellos)                    │ │          │
└──────────┘ └───────────────────────────┘ └──────────┘
 estado ·····················  Search ⌘K  Assistant  Settings
```

- **Sin cabecera.** Los paneles empiezan arriba, a un `--panel-gap` del borde de la ventana.
  Lo global (búsqueda, paneles laterales, ajustes) se abre desde la barra inferior.
- **Barra inferior.** A la izquierda, el estado de lo que se está haciendo; a la derecha, la
  identidad del contexto y un grupo de botones discretos. El botón de un panel queda
  iluminado (`aria-pressed`) mientras ese panel está abierto, y recupera el foco al cerrarlo.
- **Vista dividida.** Las dos mitades están a un `--panel-gap`; el lado interior de cada una
  pierde el margen de página. El divisor es ese hueco, sin línea: el acento aparece al pasar
  el ratón o al enfocarlo. La mitad activa se marca tiñendo el borde de su tira de pestañas
  (60 % acento), no con una raya.
- **Vistas con varias zonas** (lista + detalle, lienzo + inspector): una tira de herramientas
  y un panel por zona, todos a un `--panel-gap`.

## 6. Componentes

### Panel

```css
.panel {
  background: var(--bg-2);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
```

Cabecera: título en `--fs-base` peso 600, contador al lado, acciones a la derecha. Sin raya
debajo.

### Botones

| Variante | Aspecto | Uso |
|---|---|---|
| Principal | Fondo `--accent`, texto blanco, peso 500 | Una por vista o diálogo |
| Normal | Fondo `--bg-3` | Acción secundaria con peso (Probar) |
| Fantasma | Transparente, texto `--text-2`; al pasar, `--bg-3` y `--text` | Todo lo demás |
| Destructivo | Fantasma con texto `--danger-text` | Borrar; separado, a la izquierda |

Altura 28 px (o `--control-h` en barras), relleno `0 10px`, texto 12 px. Deshabilitado:
opacidad 0.45. Las acciones que solo importan al pasar por una fila o grupo (menú «…») se
ocultan hasta el hover o el foco.

### Campos

Altura `--control-h`, fondo `--bg-3`, borde transparente, radio `--radius-md`. El borde solo
aparece con el foco, en color acento. Las ayudas van en `--fs-xs` y `--text-2`, junto a la
etiqueta o bajo el campo.

### Control segmentado y pestañas

- **Segmentado** (elegir una entre pocas opciones excluyentes): pista con fondo `--canvas` y
  relleno de 2 px; la opción activa tiene fondo `--bg-3` y borde `--panel-border`.
- **Pestañas dentro de un diálogo:** botones sin borde; la activa toma fondo `--bg` y peso
  500. Si una pestaña no visible tiene algo configurado, lo dice con una nota en píldora
  (18 % acento): «On», «SSL · Read-only». Las flechas ←/→ cambian de pestaña.

### Tarjetas y listas

- **Tarjeta:** fondo `--bg`, sin borde, radio `--radius-md`; hover con `--hover-overlay`.
  Primera línea: punto de color y nombre. Después, metadatos en `--text-2`.
- **Fila:** sin raya inferior; seleccionada con 16 % de acento.
- **Insignia:** texto `--fs-xs` sobre un tinte, sin borde.
- **Interruptor con explicación:** casilla, nombre en peso 500 y debajo una línea que dice
  qué hace. Si no aplica, se atenúa (0.6) y la línea explica por qué.

### Diálogos

- Fondo `--bg-2`, borde `--panel-border`, radio `--radius-lg`, sombra `--modal-shadow`;
  velo `rgba(0,0,0,.55)`.
- Cabecera y pie fijos; solo se desplaza el cuerpo. El cuerpo mantiene la misma altura entre
  pestañas para que el diálogo no salte.
- Cuerpo en secciones: tarjetas con fondo `--bg`, a un `--panel-gap` entre sí.
- El resultado de una acción (probando, correcto, error) aparece en una tira justo encima de
  los botones, nunca al final de un cuerpo con scroll.
- Pie: destructivas a la izquierda; a la derecha, el motivo por el que no se puede guardar,
  la secundaria, Cancelar y la principal. Enter guarda, Escape cierra.
- Se cierra al pulsar el velo con `mousedown`, no con `click`, para no perder el formulario
  al arrastrar una selección fuera de un campo.

### Scroll

Las listas y los paneles no muestran barra de scroll. Cuando hay contenido fuera de la vista,
aparece en ese lado un botón redondo de 24 px con una flecha, sobre un degradado del color
del panel que se desvanece hacia el contenido. Las tiras horizontales (pestañas) hacen lo
mismo a izquierda y derecha, y la rueda vertical las desplaza de lado. Donde sí hace falta
barra (tablas de datos), es una píldora de 4 px en un carril de 12 px, visible al pasar.

### Foco

`outline: 2px solid var(--accent); outline-offset: -2px` con `:focus-visible` en todo lo
interactivo. Al cerrar un panel o un diálogo, el foco vuelve a quien lo abrió.

## 7. Textos

- Etiquetas y botones con mayúscula solo en la primera palabra: «Test connection».
- El botón dice lo que hace: «Create connection», «Save changes», no «OK».
- Los marcadores de posición dan un ejemplo o una instrucción, no repiten la etiqueta.
- Un error dice qué pasó y, si se sabe, qué hacer: «**Could not connect.** motivo».
- Estados en curso con gerundio y puntos suspensivos: «Testing…», «Saving…».
- Los atajos se enseñan dentro del propio control: `Search ⌘K`.

## 8. Lista de comprobación

- [ ] ¿Cada región es un panel con borde y radio, separado un `--panel-gap` de sus vecinos?
- [ ] ¿Queda alguna raya dentro de un panel que podría ser un cambio de relleno?
- [ ] ¿Todos los tamaños salen de tokens, de modo que la densidad compacta funciona sola?
- [ ] ¿Todos los colores salen de tokens o de `color-mix` sobre ellos? ¿Se ve bien en claro?
- [ ] ¿Hay una sola acción principal por vista?
- [ ] ¿Todo lo interactivo tiene foco visible y funciona con teclado?
- [ ] ¿El resultado de cada acción aparece donde el usuario está mirando?

## 9. Tokens para copiar

```css
:root {
  color-scheme: dark;
  /* Superficies y texto */
  --bg: #0f1117;
  --bg-2: #13161f;
  --bg-3: #1b1f2c;
  --border: #232838;
  --text: #e3e7f0;
  --text-2: #8b93a7;
  /* Acento y estados */
  --accent: #6366f1;
  --accent-hover: #7577f3;
  --ok: #22c55e;
  --warn: #fbbf24;
  --danger: #ef4444;
  --danger-hover: #f46868;
  --danger-text: #fca5a5;
  --hover-overlay: rgba(255, 255, 255, 0.1);
  --btn-hover-bg: #242840;
  --btn-hover-border: #343a50;
  --modal-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  /* Derivados: no se redefinen por tema */
  --canvas: light-dark(color-mix(in srgb, var(--bg) 92%, #000), color-mix(in srgb, var(--bg) 62%, #000));
  --panel-border: light-dark(color-mix(in srgb, var(--border) 78%, #000), color-mix(in srgb, var(--border) 70%, #fff));
  /* Densidad cómoda */
  --fs-base: 14px;
  --fs-sm: 13px;
  --fs-xs: 12px;
  --control-h: 36px;
  --row-h: 36px;
  --grid-row-h: 40px;
  --statusbar-h: 32px;
  --pad-x: 24px;
  --gap: 8px;
  --panel-gap: 10px;
  --radius-md: 9px;
  --radius-lg: 14px;
}

:root[data-density='compact'] {
  --fs-base: 13px;
  --fs-sm: 12px;
  --fs-xs: 11px;
  --control-h: 28px;
  --row-h: 28px;
  --grid-row-h: 26px;
  --statusbar-h: 26px;
  --pad-x: 12px;
  --gap: 6px;
  --panel-gap: 6px;
  --radius-md: 7px;
  --radius-lg: 9px;
}

:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f7f8fa;
  --bg-2: #ffffff;
  --bg-3: #eef0f4;
  --border: #d9dde6;
  --text: #1b2230;
  --text-2: #5b6577;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --ok: #16a34a;
  --warn: #b45309;
  --danger: #dc2626;
  --danger-hover: #b91c1c;
  --danger-text: #b91c1c;
  --hover-overlay: rgba(0, 0, 0, 0.08);
  --btn-hover-bg: #e4e7ee;
  --btn-hover-border: #c6cbd8;
  --modal-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--text);
  font: var(--fs-base)/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
```
