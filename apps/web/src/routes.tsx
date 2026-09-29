import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './Layout';
import { FitnessProfilePage } from './pages/FitnessProfilePage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPrototype } from './pages/onboarding-prototype/OnboardingPrototype';
import { ResultsPage } from './pages/ResultsPage';
import { SearchAreaPage } from './pages/SearchAreaPage';

/** Shared by the browser router and the memory routers in tests. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'fitness-profile', element: <FitnessProfilePage /> },
          // PROTOTYPE (branch prototype/onboarding): /fitness-profile/prototype?variant=A|B|C
          { path: 'fitness-profile/prototype', element: <OnboardingPrototype /> },
          { path: 'search-area', element: <SearchAreaPage /> },
          { path: 'results', element: <ResultsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
