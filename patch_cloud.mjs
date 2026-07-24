import fs from 'fs';
const filePath = 'src/services/cloudBackupService.ts';
let c = fs.readFileSync(filePath, 'utf8');

const oldStr = `  // ===== 更新同步状态 =====
  await d1.setSyncState(SYNC_STATE_KEY, String(startTime));

  result.duration = Date.now() - startTime;
  return result;
}

/** ============ 恢复 ============ */`;

const newStr = `  // ===== v2.0.0: 同步对话历史 =====
  const localChatSessions = await db.getAllChatSessions();
  for (const session of localChatSessions) {
    if (session.updatedAt > lastBackupTs) {
      try {
        await d1.query(
          \`INSERT OR REPLACE INTO chat_sessions (id, title, messages, model, mcp_enabled_tools, mcp_search_results, created_at, updated_at, backup_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
          [
            session.id,
            session.title,
            JSON.stringify(session.messages),
            session.model || null,
            session.mcpEnabledTools ? JSON.stringify(session.mcpEnabledTools) : null,
            session.mcpSearchResults ? JSON.stringify(session.mcpSearchResults) : null,
            session.createdAt,
            session.updatedAt,
            result.batchId,
          ],
        );
      } catch (err) {
        result.errors.push(\`sync chat_session \${session.id}: \${err instanceof Error ? err.message : String(err)}\`);
      }
    }
  }

  // ===== 更新同步状态 =====
  await d1.setSyncState(SYNC_STATE_KEY, String(startTime));

  result.duration = Date.now() - startTime;
  return result;
}

/** ============ 恢复 ============ */`;

if (c.includes(oldStr)) {
  c = c.replace(oldStr, newStr);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('OK: backupToCloud updated');
} else {
  console.log('NOT FOUND');
}
