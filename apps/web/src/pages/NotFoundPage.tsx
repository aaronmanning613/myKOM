import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-gray-700">
        <Link to="/" className="text-orange-700 underline">
          Go to the home page
        </Link>
      </p>
    </>
  );
}
