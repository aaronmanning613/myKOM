import { HealthStatusPanel } from './HealthStatusPanel';

export function App() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-3xl font-bold text-orange-600">myKOM</h1>
      <p className="mt-2 text-gray-700">
        Find the Segments near you whose record you could realistically take.
      </p>
      <HealthStatusPanel />
    </main>
  );
}
