import type { RouteObject } from 'react-router';
import { Layout } from './Layout';
import { FitnessProfilePage } from './pages/FitnessProfilePage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResultsPage } from './pages/ResultsPage';
import { SearchAreaPage } from './pages/SearchAreaPage';

/** Shared by the browser router and the memory routers in tests. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'fitness-profile', element: <FitnessProfilePage /> },
      { path: 'search-area', element: <SearchAreaPage /> },
      { path: 'results', element: <ResultsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
