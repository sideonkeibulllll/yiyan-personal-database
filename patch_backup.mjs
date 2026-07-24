import fs from 'fs';
const filePath = 'src/services/backupService.ts';
let c = fs.readFileSync(filePath, 'utf8');

const old = `  const [entries, tags, groups, settings, allTodos, allTodoTags, allTemplates, allAttachments] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    db.getSettings(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    db.getAllAttachments(),
  ]);

  // 收集所有条目的关联链接`;
const newStr = `  const [entries, tags, groups, settings, allTodos, allTodoTags, allTemplates, allAttachments, chatSessions] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    db.getSettings(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    db.getAllAttachments(),
    loadChatSessions(),
  ]);

  // 收集所有条目的关联链接`;
if (c.includes(old)) {
  c = c.replace(old, newStr);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('OK');
} else {
  console.log('NOT FOUND');
}
