import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './Layout';
import { FitnessProfilePage } from './pages/FitnessProfilePage';
import { Home } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResultsPage } from './pages/ResultsPage';
import { SearchAreaPage } from './pages/SearchAreaPage';
import { WIZARD_PATH, WizardPage } from './pages/WizardPage';

/** Shared by the browser router and the memory routers in tests. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: WIZARD_PATH, element: <WizardPage /> },
          { path: 'fitness-profile', element: <FitnessProfilePage /> },
          { path: 'search-area', element: <SearchAreaPage /> },
          { path: 'results', element: <ResultsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
