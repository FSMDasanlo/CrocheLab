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

## Pruebas

Ejecuta `node --test tests\*.test.cjs` desde la carpeta del proyecto. Las pruebas
de persistencia utilizan datos y servicios simulados; no comprueban Firebase
desplegado.

## Análisis de imágenes con Gemini

Como en MiDespensa, el navegador envía las imágenes directamente a la API de Gemini.
Para uso local, copia `js/config.example.js` como `js/config.js` e introduce una
clave de Gemini válida. El archivo `js/config.js` está excluido de Git.

La clave es visible para cualquiera que pueda acceder a la aplicación servida.
No publiques ese archivo ni despliegues la aplicación con la clave: para una web
pública usa un servidor que la proteja y controle el acceso y el consumo.
