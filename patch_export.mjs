import fs from 'fs';
const filePath = 'src/features/settings/ExportPage.tsx';
let c = fs.readFileSync(filePath, 'utf8');

// 1. 添加 import
const old1 = `import { exportAndDownload, type ExportOptions } from '@/utils/export';
import { BottomNav } from '@/components/BottomNav';
import './ExportPage.css';`;
const new1 = `import { exportAndDownload, type ExportOptions } from '@/utils/export';
import { getDatabase } from '@/services/database';
import { BottomNav } from '@/components/BottomNav';
import './ExportPage.css';`;
if (c.includes(old1)) { c = c.replace(old1, new1); console.log('OK1'); } else { console.log('FAIL1'); }

// 2. 添加 state
const old2 = `  const [includeLinks, setIncludeLinks] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [showToast, setShowToast] = useState(false);`;
const new2 = `  const [includeLinks, setIncludeLinks] = useState(true);
  const [includeChatSessions, setIncludeChatSessions] = useState(false);
  const [chatSessionCount, setChatSessionCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // 获取对话会话计数
  useState(() => {
    getDatabase().then(db => (db as any).getAllChatSessions?.()).then(sessions => {
      if (sessions) setChatSessionCount(sessions.length);
    }).catch(() => {});
  });`;
if (c.includes(old2)) { c = c.replace(old2, new2); console.log('OK2'); } else { console.log('FAIL2'); }

// 3. 添加 includeChatSessions 到导出调用
const old3 = `        includeLinks: format === 'json' ? includeLinks : undefined,
      });`;
const new3 = `        includeLinks: format === 'json' ? includeLinks : undefined,
        includeChatSessions: format === 'json' ? includeChatSessions : undefined,
      });`;
if (c.includes(old3)) { c = c.replace(old3, new3); console.log('OK3'); } else { console.log('FAIL3'); }

// 4. deps
const old4 = `    }, [format, scope, selectedTagId, includeLinks]);`;
const new4 = `    }, [format, scope, selectedTagId, includeLinks, includeChatSessions]);`;
if (c.includes(old4)) { c = c.replace(old4, new4); console.log('OK4'); } else { console.log('FAIL4'); }

// 5. UI
const old5 = `            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeLinks}
                onChange={e => setIncludeLinks(e.target.checked)}
              />
              <span>包含连线数据</span>
            </label>
          </section>
        )}`;
const new5 = `            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeLinks}
                onChange={e => setIncludeLinks(e.target.checked)}
              />
              <span>包含连线数据</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeChatSessions}
                onChange={e => setIncludeChatSessions(e.target.checked)}
              />
              <span>包含对话历史 ({chatSessionCount} 个会话)</span>
            </label>
          </section>
        )}`;
if (c.includes(old5)) { c = c.replace(old5, new5); console.log('OK5'); } else { console.log('FAIL5'); }

fs.writeFileSync(filePath, c, 'utf8');
console.log('DONE');
