/**
 * 全局 Loading 组件
 */
import './Loading.css';

export function Loading() {
  return (
    <div className="loading-container">
      <div className="loading-spinner" />
      <span className="loading-text">加载中...</span>
    </div>
  );
}
