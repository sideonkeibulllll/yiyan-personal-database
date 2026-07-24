import fs from 'fs';
const filePath = 'src/services/cloudBackupService.ts';
let c = fs.readFileSync(filePath, 'utf8');

// 在 restoreFromCloud 的末尾（最后一个 result.duration 前）插入对话恢复
const oldStr = `    } catch (err) {
      result.errors.push(\`restore attachment \${row.id}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }

  result.duration = Date.now() - startTime;`;

const newStr = `    } catch (err) {
      result.errors.push(\`restore attachment \${row.id}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }

  // ===== v2.0.0: 拉取对话历史 =====
  try {
    const d1ChatSessions = await d1.query('SELECT * FROM chat_sessions', []);
    const localSessionIds = new Set((await db.getAllChatSessions()).map(s => s.id));
    for (const row of d1ChatSessions) {
      if (localSessionIds.has(row.id)) continue;
      try {
        await db.saveChatSession({
          id: row.id,
          title: row.title,
          messages: JSON.parse(row.messages),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          model: row.model || undefined,
          mcpEnabledTools: row.mcp_enabled_tools ? JSON.parse(row.mcp_enabled_tools) : undefined,
          mcpSearchResults: row.mcp_search_results ? JSON.parse(row.mcp_search_results) : undefined,
        });
      } catch (err) {
        result.errors.push(\`restore chat_session \${row.id}: \${err instanceof Error ? err.message : String(err)}\`);
      }
    }
  } catch (err) {
    result.errors.push(\`restore chat_sessions: \${err instanceof Error ? err.message : String(err)}\`);
  }

  result.duration = Date.now() - startTime;`;

if (c.includes(oldStr)) {
  c = c.replace(oldStr, newStr);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('OK: restoreFromCloud updated');
} else {
  console.log('NOT FOUND');
}
