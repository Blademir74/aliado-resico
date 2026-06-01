// fix.js
const fs = require('fs');

console.log('🔧 Iniciando saneamiento forense de archivos...');

// 1. package.json Limpio (Node 20.x es el LTS más estable en Vercel hoy)
const pkg = {
  "name": "aliado-resico",
  "version": "7.0.0",
  "private": true,
  "engines": {
    "node": "20.x"
  }
};

// 2. vercel.json Mínimo y Blindado (Sin headers que suelan corromperse)
const vercel = {
  "version": 2,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/((?!api|styles.css|js).*)", "destination": "/index.html" }
  ]
};

// Sobrescritura a prueba de balas
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
fs.writeFileSync('vercel.json', JSON.stringify(vercel, null, 2));

console.log('✅ Archivos saneados exitosamente. Listos para Git.');