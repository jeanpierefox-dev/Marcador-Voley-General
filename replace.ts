import fs from 'fs';
let content = fs.readFileSync('components/TVOverlay.tsx', 'utf8');
content = content.replace(/match\.tvSettings/g, 'activeTvSettings');
content = content.replace(/match\.showRotation/g, 'activeShowRotation');
content = content.replace(/visibleStats/g, 'activeShowStatsOverlay');
content = content.replace(/visibleScoreboard/g, 'activeShowScoreboard');
fs.writeFileSync('components/TVOverlay.tsx', content);
console.log('Replaced successfully');
