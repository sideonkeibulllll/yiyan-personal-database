/**
 * 公共 SVG 图标组件
 *
 * 统一管理项目内的内联图标，避免各页面重复定义。
 * 默认尺寸/描边宽度与搬运前的原始定义保持一致，视觉零变化。
 */
import type { ReactNode } from 'react';

/** 图标通用属性 */
export interface IconProps {
  /** 图标尺寸（px） */
  size?: number;
  /** 描边宽度 */
  strokeWidth?: number;
}

/** 生成一个标准图标组件（stroke 风格） */
const createIcon = (
  name: string,
  defaultSize: number,
  defaultStrokeWidth: number,
  children: ReactNode,
) => {
  const Icon = ({ size = defaultSize, strokeWidth = defaultStrokeWidth }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
};

/* ===== 设置页图标 ===== */

export const IconBot = createIcon('IconBot', 20, 1.5, (
  <><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>
));

export const IconDatabase = createIcon('IconDatabase', 20, 1.5, (
  <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" /></>
));

/** 上传图标（设置页风格：20px；ChatPage 使用处传 size={16}） */
export const IconUpload = createIcon('IconUpload', 20, 1.5, (
  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" /></>
));

export const IconShuffle = createIcon('IconShuffle', 20, 1.5, (
  <><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c1.3 0 2.6-.7 3.3-1.8l.5-.8" /><path d="m18 14 4 4-4 4" /></>
));

export const IconClipboard = createIcon('IconClipboard', 20, 1.5, (
  <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 14l2 2 4-4" /></>
));

export const IconChevronUp = createIcon('IconChevronUp', 16, 1.5, (
  <path d="m18 15-6-6-6 6" />
));

/** 下拉箭头（设置页风格：16px/1.5；ChatPage 使用处传 size={12} strokeWidth={2}） */
export const IconChevronDown = createIcon('IconChevronDown', 16, 1.5, (
  <path d="m6 9 6 6 6-6" />
));

export const IconChevronRight = createIcon('IconChevronRight', 16, 1.5, (
  <path d="m9 18 6-6-6-6" />
));

export const IconBackup = createIcon('IconBackup', 20, 1.5, (
  <><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></>
));

export const IconRestore = createIcon('IconRestore', 20, 1.5, (
  <><path d="M3 12a9 9 0 1 0 9-9c-2.52 0-4.93 1-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>
));

export const IconSync = createIcon('IconSync', 20, 1.5, (
  <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
));

/** 垃圾桶（设置页风格：16px；ChatPage 使用处传 size={14}） */
export const IconTrash = createIcon('IconTrash', 16, 1.5, (
  <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>
));

export const IconDownload = createIcon('IconDownload', 16, 1.5, (
  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" /></>
));

export const IconCloud = createIcon('IconCloud', 20, 1.5, (
  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
));

export const IconWifi = createIcon('IconWifi', 20, 1.5, (
  <><path d="M5 13a10 10 0 0 1 14 0" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M2 8.82a15 15 0 0 1 20 0" /><line x1="12" y1="20" x2="12" y2="20" /></>
));

/** 发送（横向纸飞机，设置页风格） */
export const IconSend = createIcon('IconSend', 16, 1.5, (
  <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>
));

export const IconSave = createIcon('IconSave', 18, 1.5, (
  <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17,21 17,13 7,13 7,21" /><polyline points="7,3 7,8 15,8" /></>
));

/* ===== Chat 页图标 ===== */

export const IconPlus = createIcon('IconPlus', 18, 1.5, (
  <path d="M12 5v14M5 12h14" />
));

/** 发送（斜向纸飞机，Chat 页风格） */
export const IconSendAlt = createIcon('IconSendAlt', 18, 1.5, (
  <><path d="M14.536 21.086a.5.5 0 0 0 .937-.073l4.5-11.5a.5.5 0 0 0-.628-.628l-11.5 4.5a.5.5 0 0 0 .073.937l5.516 1.643z" /><path d="m14.536 21.086-1.643-5.516" /></>
));

export const IconMenu = createIcon('IconMenu', 20, 1.5, (
  <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
));

/** 关闭（16px/1.5；选中模式取消按钮使用处传 size={14} strokeWidth={2}） */
export const IconClose = createIcon('IconClose', 16, 1.5, (
  <path d="M18 6 6 18M6 6l12 12" />
));

export const IconMessage = createIcon('IconMessage', 40, 1.5, (
  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
));

export const IconEdit = createIcon('IconEdit', 14, 1.5, (
  <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>
));

export const IconCopy = createIcon('IconCopy', 14, 1.5, (
  <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>
));

export const IconBrain = createIcon('IconBrain', 16, 1.5, (
  <><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" /></>
));

export const IconTool = createIcon('IconTool', 16, 1.5, (
  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
));

export const IconBack = createIcon('IconBack', 16, 1.5, (
  <path d="m12 19-7-7 7-7M19 12H5" />
));

export const IconExit = createIcon('IconExit', 16, 1.5, (
  <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>
));

export const IconShare = createIcon('IconShare', 16, 1.5, (
  <><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></>
));

export const IconCheck = createIcon('IconCheck', 12, 3, (
  <polyline points="20 6 9 17 4 12" />
));

/* ===== 输入框撤销 / 重做 ===== */

export const IconUndo = createIcon('IconUndo', 16, 1.5, (
  <><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></>
));

export const IconRedo = createIcon('IconRedo', 16, 1.5, (
  <><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></>
));