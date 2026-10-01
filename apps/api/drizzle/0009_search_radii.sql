-- The Search Area radii went from 5/10/25/50 km to 1/2/5/10 km: a saved 25 or 50 km Search
-- Area keeps its place at the largest radius left.
UPDATE "search_areas" SET "radius_km" = 10 WHERE "radius_km" > 10;
