# CrocheLab
Patrones para croché

## Análisis de imágenes con Gemini

Como en MiDespensa, el navegador envía las imágenes directamente a la API de Gemini.
Para uso local, copia `js/config.example.js` como `js/config.js` e introduce una
clave de Gemini válida. El archivo `js/config.js` está excluido de Git.

La clave es visible para cualquiera que pueda acceder a la aplicación servida.
No publiques ese archivo ni despliegues la aplicación con la clave: para una web
pública usa un servidor que la proteja y controle el acceso y el consumo.
