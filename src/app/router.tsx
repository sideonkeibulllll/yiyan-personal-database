/**
 * 路由配置
 */
import { lazy, Suspense } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { Loading } from '@/components/Loading';

// 懒加载页面
const HomePage = lazy(() => import('@/features/input/HomePage').then(m => ({ default: m.HomePage })));
const RandomPage = lazy(() => import('@/features/random/RandomPage').then(m => ({ default: m.RandomPage })));
const SearchPage = lazy(() => import('@/features/search/SearchPage').then(m => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const TagManagePage = lazy(() => import('@/features/tags/TagManagePage').then(m => ({ default: m.TagManagePage })));
const LinkPage = lazy(() => import('@/features/links/LinkPage').then(m => ({ default: m.LinkPage })));
const ExportPage = lazy(() => import('@/features/settings/ExportPage').then(m => ({ default: m.ExportPage })));

const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<Loading />}>
        <HomePage />
      </Suspense>
    ),
  },
  {
    path: '/random',
    element: (
      <Suspense fallback={<Loading />}>
        <RandomPage />
      </Suspense>
    ),
  },
  {
    path: '/search',
    element: (
      <Suspense fallback={<Loading />}>
        <SearchPage />
      </Suspense>
    ),
  },
  {
    path: '/settings',
    element: (
      <Suspense fallback={<Loading />}>
        <SettingsPage />
      </Suspense>
    ),
  },
  {
    path: '/tags',
    element: (
      <Suspense fallback={<Loading />}>
        <TagManagePage />
      </Suspense>
    ),
  },
  {
    path: '/links/:entryId',
    element: (
      <Suspense fallback={<Loading />}>
        <LinkPage />
      </Suspense>
    ),
  },
  {
    path: '/export',
    element: (
      <Suspense fallback={<Loading />}>
        <ExportPage />
      </Suspense>
    ),
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
