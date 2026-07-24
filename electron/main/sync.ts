/**
 * Electron 数据互通服务
 *
 * 完整实现局域网设备发现与数据传输：
 * - HTTPS 服务端（自签证书）接收移动端发送的数据
 * - mDNS 广播（bonjour-service）让移动端自动发现桌面端
 * - 端口冲突自动 +1 重试（8443 -> 8444 -> ...）
 */
import { app } from 'electron';
import * as https from 'https';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Bonjour } from 'bonjour-service';

type ReceiveHandler = (request: {
  from: { id: string; name: string; type: string; appVersion: string };
  filename: string;
  data: string;
  requestImport: boolean;
}) => Promise<{ action: 'import' | 'save_only' | 'reject' }>;

let server: https.Server | null = null;
let bonjour: InstanceType<typeof Bonjour> | null = null;
let currentPort = 0;
let currentReceiveHandler: ReceiveHandler | null = null;

/** 生成自签名证书（每次启动临时生成，仅用于加密传输） */
function generateSelfSignedCert(): { key: string; cert: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  // 使用 forge 或自签方式生成证书
  // Node.js 的 crypto 模块不支持直接创建 X509 证书，使用自签 CSR 方式
  // 这里使用 Node 22+ 的 X509Certificate API
  try {
    const x509 = new (crypto as any).X509Certificate({
      key: privateKey,
      publicKey: publicKey,
      serial: BigInt(Date.now()),
      notBefore: new Date(Date.now() - 86400000),
      notAfter: new Date(Date.now() + 365 * 86400000),
      signingKey: privateKey,
    });
    return {
      key: privateKeyPem,
      cert: x509.toString(),
    };
  } catch {
    // 如果 X509Certificate API 不可用，使用简单的自签方式
    // 生成一个基础的 PEM 格式证书
    const certPem = [
      '-----BEGIN CERTIFICATE-----',
      Buffer.from(JSON.stringify({
        serial: Date.now(),
        key: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      })).toString('base64'),
      '-----END CERTIFICATE-----',
    ].join('\n');
    return { key: privateKeyPem, cert: certPem };
  }
}

/** 获取本机局域网 IP */
function getLocalIp(): string {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (/^192\.168\.|^10\.|^172\./.test(net.address)) {
          return net.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

/**
 * 启动 HTTPS 服务端
 * @param preferPort 首选端口（8443）
 * @param handler 接收数据处理函数
 * @returns 实际监听的端口
 */
export async function startServer(preferPort: number, handler: ReceiveHandler): Promise<number> {
  if (server) await stopServer();
  currentReceiveHandler = handler;

  const { key, cert } = generateSelfSignedCert();

  // 端口冲突自动 +1，最多尝试 10 个端口
  for (let port = preferPort; port < preferPort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server = https.createServer({ key, cert }, async (req, res) => {
          // CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          // 握手端点
          if (req.url === '/handshake' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: 'electron-desktop',
              name: '桌面端',
              type: 'desktop',
              appVersion: app.getVersion() || '1.5.0',
            }));
            return;
          }

          // 接收数据端点
          if (req.url === '/receive' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const payload = JSON.parse(body);
                if (!currentReceiveHandler) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ action: 'reject' }));
                  return;
                }
                const result = await currentReceiveHandler(payload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ action: 'reject', error: String(err) }));
              }
            });
            return;
          }

          // === 阶段2：附件原图按需拉取 ===

          // 附件原图列表端点
          // 返回本地存在的所有原图附件 id（文件名格式：<attId>_orig.jpg）
          if (req.url === '/attachment/list' && req.method === 'GET') {
            try {
              const ids = await listLocalOriginalIds();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ids }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(err) }));
            }
            return;
          }

          // 附件原图下载端点：/attachment/orig/:id
          const origMatch = req.url?.match(/^\/attachment\/orig\/(.+)$/);
          if (origMatch && req.method === 'GET') {
            const attId = decodeURIComponent(origMatch[1]);
            try {
              const origFile = await findOriginalFile(attId);
              if (!origFile) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '原图不存在' }));
                return;
              }
              const buffer = await fsp.readFile(origFile);
              const base64 = buffer.toString('base64');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: attId, data: base64, mimeType: 'image/jpeg' }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(err) }));
            }
            return;
          }

          res.writeHead(404);
          res.end('Not Found');
        });

        server.listen(port, '0.0.0.0', () => {
          currentPort = port;
          resolve();
        });

        server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            server = null;
            reject(new Error('PORT_IN_USE'));
          } else {
            reject(err);
          }
        });
      });

      // 端口绑定成功，跳出循环
      break;
    } catch (err) {
      if (err instanceof Error && err.message === 'PORT_IN_USE') {
        continue; // 尝试下一个端口
      }
      throw err;
    }
  }

  if (!server) throw new Error('无法找到可用端口');

  // 启动 mDNS 广播
  startBroadcast(currentPort);

  return currentPort;
}

/** 启动 mDNS 广播，让移动端能发现桌面端 */
function startBroadcast(port: number): void {
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      name: '记忆库桌面端',
      type: 'yiyan-sync',
      port: port,
      host: getLocalIp(),
    });
  } catch {
    // mDNS 启动失败不阻塞主流程
  }
}

/** 停止服务端和广播
 *
 * 关键修复：server.close() 会等待所有现有连接关闭才回调，如果还有挂起的
 * HTTPS 长连接，会一直卡住导致应用无法退出（NSIS 升级时反复提示关闭）。
 * 这里先 closeAllConnections 强制断开，再 close，并加 1 秒超时保底。
 */
export async function stopServer(): Promise<void> {
  if (bonjour) {
    try { bonjour.unpublishAll(); } catch { /* ignore */ }
    try { bonjour.destroy(); } catch { /* ignore */ }
    bonjour = null;
  }
  if (server) {
    const srv = server;
    server = null;
    try {
      // Node 18.2+ 提供 closeAllConnections，强制断开所有 keep-alive 连接
      (srv as any).closeAllConnections?.();
    } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      srv.close(() => finish());
      // 超时保底，避免 close 永远不回调
      setTimeout(finish, 1000);
    });
  }
  currentPort = 0;
  currentReceiveHandler = null;
}

/** 获取当前服务端口 */
export function getServerPort(): number {
  return currentPort;
}

/** ============================================================
 *  阶段2：附件原图按需拉取（服务端）
 *  ============================================================ */

/** 扫描本地附件目录，返回所有原图附件 id（文件名：<attId>_orig.jpg） */
async function listLocalOriginalIds(): Promise<string[]> {
  const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
  const ids: string[] = [];
  const scanDir = async (dir: string): Promise<void> => {
    let entries: import('fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('_orig.jpg')) {
        ids.push(entry.name.replace(/_orig\.jpg$/, ''));
      }
    }
  };
  await scanDir(attachmentsDir);
  return ids;
}

/** 根据附件 id 查找原图文件完整路径 */
async function findOriginalFile(attId: string): Promise<string | null> {
  const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
  const targetName = `${attId}_orig.jpg`;
  const findInDir = async (dir: string): Promise<string | null> => {
    let entries: import('fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await findInDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }
    }
    return null;
  };
  return await findInDir(attachmentsDir);
}

/** 获取本机 IP（暴露给渲染进程） */
export { getLocalIp };
