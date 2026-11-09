# CrocheLab
Patrones para croché

## Proyectos y fotografías

Los proyectos locales y los de Firebase son bibliotecas independientes; iniciar
sesión no mueve ni sincroniza los datos locales. Si cambia el espacio mientras
hay una edición abierta, copia los cambios antes de cerrar el formulario y vuelve
a abrir el proyecto en el espacio correspondiente.

La aplicación comprueba cambios concurrentes antes de guardar o eliminar.
Si detecta un conflicto, no sobrescribe el documento: conserva los cambios
pendientes, recarga el proyecto y compáralos. Una versión antigua de la
aplicación que no haga estas comprobaciones puede escribir sin respetarlas.
Si un boceto anterior contiene una construcción distinta de la que genera el
editor actual, tampoco se reemplaza automáticamente.

Al eliminar un proyecto local se eliminan también sus fotografías locales y su
boceto. Al eliminar un proyecto de Firebase se eliminan sus documentos, pero se
conservan las fotografías en Storage. Una subida interrumpida puede dejar
archivos sin asociar; no se eliminan automáticamente. Si no se puede confirmar
un guardado, comprueba el proyecto antes de reintentarlo. Al cerrar la página se
pueden perder los cambios y las referencias de una operación pendiente.
Mientras exista una reconstrucción guardada se bloquea la eliminación del
proyecto y la retirada de fotografías; sí se pueden añadir fotografías.

## Generación automática

En **Reconstrucción**, selecciona o crea un proyecto con fotografías generales
y de detalle y pulsa **GENERAR PATRÓN**. Cada imagen se analiza por separado;
después el servicio propone una construcción a partir de los hallazgos. El
núcleo la ejecuta y valida y, si hay una traza ejecutable, genera instrucciones
y un grafo de símbolos desde esa misma traza. La aplicación guarda la propuesta
en el espacio del proyecto y conserva las versiones anteriores.

Las observaciones, inferencias, suposiciones, fotos que no pudieron analizarse y
aspectos desconocidos se muestran junto al resultado. Una propuesta es
automática y no está verificada por una persona; la validez lógica no garantiza
que reproduzca la prenda ni que sea físicamente tejible. El grafo representa
conexiones, no la silueta de la prenda. Si la información o las operaciones
admitidas no bastan, puede no existir una secuencia o un esquema ejecutable.
El boceto orientativo antiguo permanece separado.

La construcción generada se limita a las técnicas del núcleo. La interfaz
técnica anterior permanece oculta y los datos de las revisiones manuales
existentes se conservan. Para evitar superar el límite de documento de
Firestore, el guardado se rechaza si el historial completo supera 700 000 bytes;
ninguna versión se descarta automáticamente.

## Pruebas

Instala las dependencias de desarrollo con `npm ci` y ejecuta `npm test` desde
la carpeta del proyecto. También puedes ejecutar solo el núcleo con
`node --test tests\crochet-schema.test.cjs tests\crochet-core.test.cjs`.
Ajv comprueba los esquemas JSON de forma independiente en las pruebas; el núcleo
no depende de Ajv en tiempo de ejecución. Las pruebas de persistencia utilizan
datos y servicios simulados; no comprueban Firebase desplegado.

## Núcleo lógico experimental

`js/crochet-core/index.mjs` ofrece `expand(document)`, `execute(document)`,
`validateDocument(document)` y `applyCorrection(document, correction)`. Es
independiente de la interfaz y del almacenamiento. No convierte los bocetos
existentes; la integración de reconstrucción utiliza su traza para producir
instrucciones y un grafo separados.

El contrato de entrada está en `schemas/crochet-core.schema.json` y el de
salida en `schemas/crochet-trace.schema.json`. El motor comprueba su propio
contrato de dominio; no pretende ser un validador genérico de JSON Schema.
Los documentos y resultados de ejemplo se ejercitan en
`tests/crochet-core.test.cjs`.

El bucle inicial tiene identidad propia y un origen explícito: no es un
anclaje. Cada operación que teje recibe el bucle anterior y produce otro.
La salida de una fila se convierte en la frontera de la siguiente: por ejemplo,
si la fila 1 exporta los anclajes `row1/p1/top`, `row1/p2/top` y
`row1/p3/top` con orden `reverse`, la fila 2 los recibe en el orden
`p3`, `p2`, `p1`, junto con el bucle `row1/p3/loop`. La fila 2 debe
comenzar con un giro explícito antes de trabajar en esa frontera.

La traza separa puntos, cadenetas y espacios, y registra el motivo de cada
reutilización autorizada. Las convenciones del documento determinan los
recuentos de fila y los anclajes exportados. Una entrada no utilizada debe
declararse conservada u omitida. Cuando falta información, o hay una referencia
rota, no se presentan recuentos parciales como completos.

Las correcciones actuales permiten modificar parámetros de operaciones directas
o de una instancia de motivo en una repetición. `applyCorrection` devuelve una nueva revisión en memoria,
con el valor anterior y el nuevo, sin guardar ni modificar la revisión anterior.
Las referencias a salidas eliminadas quedan sin resolver. El grafo incluye
dependencias del hilo, por lo que operaciones posteriores pueden necesitar
recálculo aunque sus IDs y definiciones no cambien.

El núcleo admite filas de ida y vuelta, puntos básicos, cadenetas, deslizados,
aumentos, la disminución de dos puntos bajos juntos, espacios, motivos y
repeticiones de un nivel. No admite vueltas circulares, cambios de hilo,
costuras, uniones entre piezas, motivos recursivos ni repeticiones anidadas.
Una validación correcta solo certifica coherencia dentro de estas reglas;
no verifica automáticamente la viabilidad física ni la fidelidad a una prenda.

## Análisis de imágenes con Gemini (Firebase AI Logic)

El navegador **nunca** recibe una clave de Gemini. CrochéLab llama a Gemini a través de
**Firebase AI Logic** (`js/firebase-ai.mjs`): la clave vive dentro de Firebase y **App Check**
(reCAPTCHA v3) hace que solo esta web pueda usarla. GitHub Pages sigue sirviendo la
aplicación y el workflow de despliegue no usa ningún secreto de Gemini.

Modelo: `gemini-3.5-flash-lite`. Admite imágenes y respuestas JSON estructuradas con
Firebase AI Logic y no exige plan de pago. Se cambia en `DEFAULT_GEMINI_MODEL` de `js/ai-analysis.js`.

Si falta la clave de sitio de App Check, el análisis con IA queda desactivado (no hay modo sin protección).

### Configuración de Firebase Console, paso a paso

Proyecto: `crochelab-bd7ee` (https://console.firebase.google.com/project/crochelab-bd7ee).

1. **Activar AI Logic.** Menú *Build → AI Logic → Get started*. Elige **Gemini Developer API**
   y completa el asistente. Firebase crea y guarda la clave de Gemini por ti; no hay que copiarla en el código.
   Si el asistente ofrece activar App Check, acepta.
2. **Crear la clave de reCAPTCHA v3.** Entra en https://www.google.com/recaptcha/admin/create:
   etiqueta `CrochéLab`, tipo **reCAPTCHA v3**, dominio **`fsmdasanlo.github.io`** únicamente.
   **No añadas `localhost`**: permitiría usar tu app desde cualquier ordenador. Copia la
   *clave del sitio* (pública) y la *clave secreta*.
3. **Registrar la app web en App Check.** *Build → App Check → Apps*, tu app web, proveedor
   **reCAPTCHA** (v3). Pega la *clave secreta* en Firebase (no en el código) y guarda.
4. **Poner la clave del sitio en la app.** En `js/firebase-config.js`, rellena
   `window.CROCHELAB_APPCHECK_SITE_KEY = "…"` con la *clave del sitio* (es pública, no es secreta).
5. **Hacer obligatorio App Check.** *App Check → pestaña APIs → Firebase AI Logic → Set up*:
   *Baseline protection = Enforced*. Sin este paso la protección no se aplica.
6. **Restringir y vigilar.** En Google Cloud Console → *APIs y servicios → Credenciales*, la clave
   que Firebase creó para Gemini y tu clave web de Firebase deben tener restricciones de API.
   Revoca cualquier clave de Gemini antigua en https://aistudio.google.com/apikey. Fija cuotas o presupuesto.
7. **Publicar.** Haz commit y push; el workflow publica la web en GitHub Pages.

### Prueba en local (token de depuración)

1. Sirve la web con un servidor que entregue `.mjs` como JavaScript (por ejemplo la extensión
   Live Server de VS Code, puerto 5500; `python -m http.server` en Windows no sirve).
2. Abre `http://localhost:5500`, con la clave del sitio ya rellenada, y mira la consola del navegador:
   aparece `App Check debug token: …`.
3. En Firebase Console → *App Check → Apps → tu app web → ⋮ → Manage debug tokens*, añádelo.
   Se guarda en el navegador y no hay que repetirlo. No lo subas a Git ni lo compartas.
4. Abre un proyecto con fotos y pulsa analizar. Si responde, todo está correcto.

En producción nunca se activa el token de depuración: solo se usa cuando el host es `localhost` o `127.0.0.1`.