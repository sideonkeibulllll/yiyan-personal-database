/**
 * 图片查看器组件
 * - 全屏黑色遮罩
 * - 左右滑动切换（触摸 + 鼠标拖拽）—— v2.7.0：手机端未缩放时也能滑动切图
 * - 放大后单指拖拽平移图片查看边缘（v2.7.0 修复：以前只能看放大后的中心区域）
 * - 手机端：双指缩放；PC 端：双击缩放
 * - 单击：未放大时关闭，已放大时先复位
 * - 顶部计数器 1/5
 * - 左右箭头按钮（PC 友好）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import './ImageViewer.css';

interface ImageViewerProps {
  /** 图片 src 列表（data URL 或 URL） */
  images: string[];
  /** 起始索引 */
  startIndex?: number;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 是否为触屏设备（决定用双指缩放还是双击缩放）
 *
 * 用 Capacitor.getPlatform() 精准判断：android/ios 走双指缩放，web（含 Electron）走双击缩放。
 * 不用 'ontouchstart' in window，因为部分 Capacitor WebView 不可靠，会导致真机误走双击分支。
 */
const IS_TOUCH = (() => {
  try {
    return Capacitor.getPlatform() !== 'web';
  } catch {
    return typeof window !== 'undefined' && 'ontouchstart' in window;
  }
})();

const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** 松手后仍小于此值就自动还原（避免「缩了一点点」卡在中间态） */
const SNAP_BACK_SCALE = 1.15;

export function ImageViewer({ images, startIndex = 0, onClose }: ImageViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  /** 未放大时：拖动产生的横向位移（用于切换图片） */
  const [dragX, setDragX] = useState(0);
  /** 已放大时：图片的平移量（用于查看边缘） */
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const lastClickTime = useRef(0);
  const hasDragged = useRef(false);

  // 双指缩放相关
  const isPinching = useRef(false);
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);

  /** 复位缩放与平移 */
  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setDragX(0);
  }, []);

  // 切换到指定索引（循环）
  const goTo = useCallback((i: number) => {
    if (images.length === 0) return;
    const next = (i + images.length) % images.length;
    setIndex(next);
    resetZoom();
  }, [images.length, resetZoom]);

  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  /**
   * 把平移量限制在「图片放大后超出容器的范围」内，
   * 防止拖动时把图片甩出屏幕（这正是以前「只能看中心」的根源）。
   */
  const clampPan = useCallback((p: { x: number; y: number }) => {
    const container = containerRef.current;
    const img = trackRef.current?.querySelector<HTMLImageElement>('.image-viewer-slide.is-current img');
    if (!container || !img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    // rect 已包含 scale 与当前 pan，这里要用「不含 pan」的尺寸：减去 pan 的偏移不影响尺寸
    const maxX = Math.max(0, (rect.width - container.offsetWidth) / 2);
    const maxY = Math.max(0, (rect.height - container.offsetHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, p.x)),
      y: Math.min(maxY, Math.max(-maxY, p.y)),
    };
  }, []);

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (scale !== 1) resetZoom();
        else onClose();
      } else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goNext, goPrev, scale, resetZoom]);

  /* -------------------- 单指拖拽：切图 或 平移 -------------------- */
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isPinching.current) return; // 双指缩放中，不处理单指拖拽
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
    hasDragged.current = false;
    setIsDragging(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDragged.current = true;

    if (scale > 1) {
      // 放大状态：平移图片看边缘
      setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
    } else {
      // 原始比例：横向拖动准备切图
      setDragX(dx);
    }
  }, [isDragging, scale]);

  const onPointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    if (scale > 1) {
      // 平移结束：吸附回可视范围
      setPan(p => clampPan(p));
      return;
    }

    // 切图判定
    const threshold = (containerRef.current?.offsetWidth ?? 300) * 0.2;
    if (dragX < -threshold) {
      goNext();
    } else if (dragX > threshold) {
      goPrev();
    } else {
      setDragX(0);
    }
  }, [isDragging, scale, dragX, goNext, goPrev, clampPan]);

  /* -------------------- 双指缩放 -------------------- */
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      setIsDragging(false);
      setDragX(0);
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy) || 1;
      pinchStartScale.current = scale;
    }
  }, [scale]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPinching.current && e.touches.length === 2) {
      e.preventDefault(); // 阻止页面滚动
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy) || 1;
      const next = pinchStartScale.current * dist / pinchStartDist.current;
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      isPinching.current = false;
      setScale(s => {
        if (s < SNAP_BACK_SCALE) {
          setPan({ x: 0, y: 0 });
          return 1;
        }
        return s;
      });
      // 缩放后把平移量收进边界
      setTimeout(() => setPan(p => clampPan(p)), 0);
    }
  }, [clampPan]);

  /* -------------------- 单击：关闭 / 复位，PC 双击缩放 -------------------- */
  const onClick = useCallback(() => {
    if (hasDragged.current || isPinching.current) return;

    const now = Date.now();
    const isDoubleTap = now - lastClickTime.current < 300;

    // 已放大：单击先复位（无论是手机还是 PC）
    if (scale !== 1) {
      resetZoom();
      lastClickTime.current = 0;
      return;
    }

    if (IS_TOUCH) {
      onClose();
      return;
    }

    // PC：双击缩放
    if (isDoubleTap) {
      setScale(2);
      lastClickTime.current = 0;
    } else {
      lastClickTime.current = now;
      setTimeout(() => {
        if (lastClickTime.current === now && !hasDragged.current) {
          onClose();
        }
      }, 280);
    }
  }, [onClose, scale, resetZoom]);

  if (images.length === 0) return null;

  const zoomed = scale !== 1;

  return (
    <div
      className="image-viewer"
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onClick}
    >
      {/* 顶部计数器 */}
      <div className="image-viewer-counter">
        {index + 1} / {images.length}
      </div>

      {/* 关闭按钮 */}
      <button
        className="image-viewer-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="关闭"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      {/* 左箭头 */}
      {images.length > 1 && (
        <button
          className="image-viewer-arrow image-viewer-arrow-prev"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label="上一张"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}

      {/* 图片轨道 */}
      <div
        className="image-viewer-track"
        ref={trackRef}
        style={{
          transform: `translate3d(calc(${-index * 100}% + ${dragX}px), 0, 0)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease',
        }}
      >
        {images.map((src, i) => (
          <div className={`image-viewer-slide${i === index ? ' is-current' : ''}`} key={i}>
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                transform: i === index
                  ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`
                  : 'scale(1)',
                transition: isDragging ? 'none' : 'transform 0.3s ease',
              }}
            />
          </div>
        ))}
      </div>

      {/* 右箭头 */}
      {images.length > 1 && (
        <button
          className="image-viewer-arrow image-viewer-arrow-next"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="下一张"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}

      {/* 底部提示 */}
      <div className="image-viewer-hint">
        {zoomed
          ? '拖动查看边缘 · 单击复位'
          : (IS_TOUCH ? '左右滑动切换 · 双指缩放 · 单击关闭' : '左右滑动切换 · 双击放大 · 单击关闭')}
      </div>
    </div>
  );
}
