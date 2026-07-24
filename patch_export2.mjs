import fs from 'fs';
const filePath = 'src/features/settings/ExportPage.tsx';
let c = fs.readFileSync(filePath, 'utf8');
const re = /\}, \[format, scope, selectedTagId, includeLinks\]\);/;
if (re.test(c)) {
  c = c.replace(re, '}, [format, scope, selectedTagId, includeLinks, includeChatSessions]);');
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('OK4 fixed');
} else {
  console.log('FAIL4');
}
