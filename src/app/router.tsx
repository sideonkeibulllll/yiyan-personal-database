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
const DataManagerPage = lazy(() => import('@/features/datamanager/DataManagerPage').then(m => ({ default: m.DataManagerPage })));
const EntryEditPage = lazy(() => import('@/features/entry/EntryEditPage').then(m => ({ default: m.EntryEditPage })));
const ChatPage = lazy(() => import('@/features/chat/ChatPage').then(m => ({ default: m.ChatPage })));
const TodoPage = lazy(() => import('@/features/todo/TodoPage').then(m => ({ default: m.TodoPage })));
const TodoEditPage = lazy(() => import('@/features/todo/TodoEditPage').then(m => ({ default: m.TodoEditPage })));
const TodoManagerPage = lazy(() => import('@/features/todo/TodoManagerPage').then(m => ({ default: m.TodoManagerPage })));
const TodoTemplatePage = lazy(() => import('@/features/todo/TodoTemplatePage').then(m => ({ default: m.TodoTemplatePage })));
const TodoRecycleBinPage = lazy(() => import('@/features/todo/TodoRecycleBinPage').then(m => ({ default: m.TodoRecycleBinPage })));

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
  {
    path: '/data-manager',
    element: (
      <Suspense fallback={<Loading />}>
        <DataManagerPage />
      </Suspense>
    ),
  },
  {
    path: '/data-manager/:mode',
    element: (
      <Suspense fallback={<Loading />}>
        <DataManagerPage />
      </Suspense>
    ),
  },
  {
    path: '/entry/:id/edit',
    element: (
      <Suspense fallback={<Loading />}>
        <EntryEditPage />
      </Suspense>
    ),
  },
  {
    path: '/chat',
    element: (
      <Suspense fallback={<Loading />}>
        <ChatPage />
      </Suspense>
    ),
  },
  {
    path: '/chat/:sessionId',
    element: (
      <Suspense fallback={<Loading />}>
        <ChatPage />
      </Suspense>
    ),
  },
  {
    path: '/todo',
    element: (
      <Suspense fallback={<Loading />}>
        <TodoPage />
      </Suspense>
    ),
  },
  {
    path: '/todo/new',
    element: (
      <Suspense fallback={<Loading />}>
        <TodoEditPage />
      </Suspense>
    ),
  },
  {
    path: '/todo/:id/edit',
    element: (
      <Suspense fallback={<Loading />}>
        <TodoEditPage />
      </Suspense>
    ),
  },
  {
    path: '/todo/manager',
    element: (
      <Suspense fallback={<Loading />}>
        <TodoManagerPage />
      </Suspense>
    ),
  },
  {
    path: '/todo/templates',
    element: (
      <Suspense fallback={<Loading />}>
        <TodoTemplatePage />
      </Suspense>
    ),
  },
  {
    path: '/todo/recycle-bin',
    element: (
      <Suspense fallback={<Loading />}>
        <TodoRecycleBinPage />
      </Suspense>
    ),
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
