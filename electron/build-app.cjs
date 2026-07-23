/**
 * 手动打包 Electron 应用
 * 将 dist/ + dist-electron/ + 依赖 打包到 win-unpacked/resources/app/
 * 绕过 electron-builder 的 EPERM rename 问题
 *
 * 依赖收集策略：递归读取每个依赖的 package.json dependencies 字段，
 * 自动收集完整的依赖树（包括嵌套依赖）
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appDir = path.join(rootDir, 'release-electron', 'win-unpacked', 'resources', 'app');

// 需要复制到 app/ 的文件/目录
const itemsToCopy = [
  'dist',           // 前端构建产物
  'dist-electron',  // Electron 主进程编译产物
  'package.json',
];

// 顶层生产依赖（入口包，子依赖会自动递归收集）
const rootProdDeps = [
  'sql.js',
  'bonjour-service',
  'jszip',
  'react',
  'react-dom',
  'react-router-dom',
  'zustand',
  'antd-mobile',
  'antd-mobile-icons',
  '@capacitor/core',
  '@capacitor-community/sqlite',
  '@capacitor/filesystem',
  '@capacitor/app',
  '@capacitor/clipboard',
  '@capacitor/haptics',
  '@capacitor/status-bar',
  'jeep-sqlite',
];

// 递归复制目录
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 递归收集依赖树
 * 读取 node_modules 中每个包的 package.json，获取其 dependencies，
 * 然后递归收集子依赖
 */
function collectDeps(depNames, nodeModulesSrc, visited = new Set()) {
  const result = new Set();
  const queue = [...depNames];

  while (queue.length > 0) {
    const dep = queue.shift();
    if (visited.has(dep)) continue;
    visited.add(dep);

    // 支持带 scope 的包名（如 @capacitor/core）
    const depPath = path.join(nodeModulesSrc, dep);
    if (!fs.existsSync(depPath)) {
      console.warn('  Skip (not found):', dep);
      continue;
    }

    result.add(dep);

    // 读取该包的 package.json，获取其依赖
    const pkgJsonPath = path.join(depPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const subDeps = pkg.dependencies || {};
        for (const subDep of Object.keys(subDeps)) {
          if (!visited.has(subDep)) {
            queue.push(subDep);
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    // 处理 peerDependencies（可选，某些包需要）
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const peerDeps = pkg.peerDependencies || {};
        for (const peerDep of Object.keys(peerDeps)) {
          if (!visited.has(peerDep) && fs.existsSync(path.join(nodeModulesSrc, peerDep))) {
            queue.push(peerDep);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return result;
}

console.log('Building app directory:', appDir);

// 1. 清理/创建 app 目录
if (fs.existsSync(appDir)) {
  fs.rmSync(appDir, { recursive: true, force: true });
}
fs.mkdirSync(appDir, { recursive: true });

// 2. 复制项目文件
for (const item of itemsToCopy) {
  const src = path.join(rootDir, item);
  const dest = path.join(appDir, item);
  if (!fs.existsSync(src)) {
    console.warn('Skip (not found):', item);
    continue;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDirSync(src, dest);
    console.log('Copied dir:', item);
  } else {
    fs.copyFileSync(src, dest);
    console.log('Copied file:', item);
  }
}

// 2.5 覆盖 package.json：移除 "type": "module"（Electron 主进程需要 CommonJS）
const pkgJsonPath = path.join(appDir, 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
delete pkgJson.type;
delete pkgJson.scripts;
delete pkgJson.devDependencies;
delete pkgJson.build;
// 只保留运行时必需的字段
const runtimePkg = {
  name: pkgJson.name,
  version: pkgJson.version,
  main: 'dist-electron/main/main.js',
  dependencies: pkgJson.dependencies,
};
fs.writeFileSync(pkgJsonPath, JSON.stringify(runtimePkg, null, 2));
console.log('Overwrote package.json (removed type:module, kept runtime fields)');

// 3. 递归收集完整的依赖树
const nodeModulesSrc = path.join(rootDir, 'node_modules');
const nodeModulesDest = path.join(appDir, 'node_modules');
fs.mkdirSync(nodeModulesDest, { recursive: true });

console.log('\nCollecting dependency tree...');
const allDeps = collectDeps(rootProdDeps, nodeModulesSrc);
console.log(`Found ${allDeps.size} packages (including transitive deps)\n`);

// 4. 复制所有依赖
for (const dep of allDeps) {
  const src = path.join(nodeModulesSrc, dep);
  const dest = path.join(nodeModulesDest, dep);
  if (!fs.existsSync(src)) {
    console.warn('  Skip dep (not found):', dep);
    continue;
  }
  copyDirSync(src, dest);
}
console.log(`Copied ${allDeps.size} packages to node_modules/`);

// 5. 复制 sql.js 的 wasm 文件到 extraResources 位置
const wasmSrc = path.join(nodeModulesSrc, 'sql.js', 'dist', 'sql-wasm.wasm');
const resourcesDir = path.join(rootDir, 'release-electron', 'win-unpacked', 'resources');
if (fs.existsSync(wasmSrc)) {
  fs.copyFileSync(wasmSrc, path.join(resourcesDir, 'sql-wasm.wasm'));
  console.log('Copied sql-wasm.wasm to resources/');
}

// 6. 重命名 electron.exe -> 记忆库.exe 并注入图标和版本信息
const { execSync } = require('child_process');
const unpackDir = path.join(rootDir, 'release-electron', 'win-unpacked');
const oldExe = path.join(unpackDir, 'electron.exe');
const newExe = path.join(unpackDir, '记忆库.exe');
const icoPath = path.join(rootDir, 'electron', 'build', 'icon.ico');

// 查找 rcedit（在 electron-builder 缓存中）
const cacheBase = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
let rcedit = null;
if (fs.existsSync(cacheBase)) {
  const dirs = fs.readdirSync(cacheBase);
  for (const dir of dirs) {
    const candidate = path.join(cacheBase, dir, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) {
      rcedit = candidate;
      break;
    }
  }
}

if (fs.existsSync(oldExe)) {
  // 删除旧的 记忆库.exe（如果存在）
  if (fs.existsSync(newExe)) fs.unlinkSync(newExe);
  fs.renameSync(oldExe, newExe);
  console.log('\nRenamed: electron.exe -> 记忆库.exe');

  // 用 rcedit 注入图标和版本信息
  if (rcedit && fs.existsSync(icoPath)) {
    try {
      execSync(`"${rcedit}" "${newExe}" --set-icon "${icoPath}"`, { stdio: 'pipe' });
      execSync(`"${rcedit}" "${newExe}" --set-version-string "ProductName" "记忆库"`, { stdio: 'pipe' });
      execSync(`"${rcedit}" "${newExe}" --set-version-string "FileDescription" "记忆库"`, { stdio: 'pipe' });
      console.log('Icon and version info applied to 记忆库.exe');
    } catch (e) {
      console.warn('rcedit failed (icon not applied):', e.message);
    }
  } else {
    console.warn('rcedit or icon.ico not found, skipping icon injection');
  }
} else if (fs.existsSync(newExe)) {
  console.log('\n记忆库.exe already exists (already renamed)');
} else {
  console.warn('\nNeither electron.exe nor 记忆库.exe found in win-unpacked!');
}

console.log('\nDone! App packaged to:', appDir);
console.log('You can now run: release-electron/win-unpacked/记忆库.exe');
