const fs = require('fs');
const path = require('path');

function searchFiles(dir, pattern) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next' && file !== '.git') {
        searchFiles(fullPath, pattern);
      }
    } else {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(pattern)) {
        console.log(`Found pattern in: ${fullPath}`);
      }
    }
  }
}

searchFiles('C:\\Users\\campe\\Desktop\\RedTerritorio', 'Iniciar');
searchFiles('C:\\Users\\campe\\Desktop\\RedTerritorio', 'tasks/walk-list');
