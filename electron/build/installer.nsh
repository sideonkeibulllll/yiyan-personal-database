; NSIS 自定义脚本：安装前强制关闭运行中的记忆库
; 作为双保险，防止旧版本应用进程残留导致文件占用、安装失败或反复提示
!macro customInit
  ; 兜底：taskkill 强制结束进程（/IM 支持中文 EXE 名，最可靠）
  ; 不依赖窗口查找（避免与 Chrome 等 Chromium 应用窗口类名冲突）
  nsExec::ExecToLog 'taskkill /F /IM "记忆库.exe"'
  Pop $0
  Sleep 500
!macroend
