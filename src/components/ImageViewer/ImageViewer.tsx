/**
 * 图片查看器组件
 * - 全屏黑色遮罩
 * - 左右滑动切换（触摸 + 鼠标拖拽）
 * - 手机端：双指缩放；PC 端：双击缩放
 * - 单击关闭
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

export function ImageViewer({ images, startIndex = 0, onClose }: ImageViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const lastClickTime = useRef(0);
  const hasDragged = useRef(false);

  // 双指缩放相关
  const isPinching = useRef(false);
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);

  // 切换到指定索引（循环）
  const goTo = useCallback((i: number) => {
    if (images.length === 0) return;
    const next = (i + images.length) % images.length;
    setIndex(next);
    setScale(1);
    setDragX(0);
  }, [images.length]);

  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goNext, goPrev]);

  // 拖拽开始
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isPinching.current) return; // 双指缩放中，不处理单指拖拽
    if (scale !== 1) return; // 放大状态不切换
    dragStartX.current = e.clientX;
    hasDragged.current = false;
    setIsDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [scale]);

  // 拖拽移动
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX.current;
    if (Math.abs(dx) > 5) hasDragged.current = true;
    setDragX(dx);
  }, [isDragging]);

  // 拖拽结束
  const onPointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = (containerRef.current?.offsetWidth ?? 300) * 0.2;
    if (dragX < -threshold) {
      goNext();
    } else if (dragX > threshold) {
      goPrev();
    } else {
      setDragX(0);
    }
  }, [isDragging, dragX, goNext, goPrev]);

  // 双指缩放：touch 事件
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // 进入双指缩放模式
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
      const newScale = Math.min(4, Math.max(1, pinchStartScale.current * dist / pinchStartDist.current));
      setScale(newScale);
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      isPinching.current = false;
      // 缩放过小自动还原
      setScale(s => (s < 1.2 ? 1 : s));
    }
  }, []);

  // 单击关闭 / 双击缩放（PC）
  const onClick = useCallback(() => {
    // 触屏：只用双指缩放，单击关闭（不双击）
    if (IS_TOUCH) {
      if (!hasDragged.current && !isPinching.current) onClose();
      return;
    }
    // PC：双击缩放
    const now = Date.now();
    if (now - lastClickTime.current < 300) {
      setScale(s => s === 1 ? 2 : 1);
      lastClickTime.current = 0;
    } else {
      lastClickTime.current = now;
      setTimeout(() => {
        if (lastClickTime.current === now && !hasDragged.current) {
          onClose();
        }
      }, 280);
    }
  }, [onClose]);

  if (images.length === 0) return null;

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
        style={{
          transform: `translate3d(calc(${-index * 100}% + ${dragX}px), 0, 0)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease',
        }}
      >
        {images.map((src, i) => (
          <div className="image-viewer-slide" key={i}>
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                transform: i === index ? `scale(${scale})` : 'scale(1)',
                transition: 'transform 0.3s ease',
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
        {IS_TOUCH
          ? (scale !== 1 ? '双指缩放还原 · 单击关闭' : '左右滑动切换 · 双指缩放 · 单击关闭')
          : (scale !== 1 ? '双击还原 · 单击还原后关闭' : '左右滑动切换 · 双击放大 · 单击关闭')}
      </div>
    </div>
  );
}
