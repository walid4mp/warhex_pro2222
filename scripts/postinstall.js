const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
for (const f of ['users.json', 'matches.json', 'friends.json', 'achievements.json']) {
  const fp = path.join(dataDir, f);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]');
}
const envFile = path.join(__dirname, '..', '.env');
const envExample = path.join(__dirname, '..', '.env.example');
if (!fs.existsSync(envFile) && fs.existsSync(envExample)) fs.copyFileSync(envExample, envFile);
console.log('✓ postinstall: data files ready');
