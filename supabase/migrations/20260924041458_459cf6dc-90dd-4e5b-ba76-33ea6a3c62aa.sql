ALTER FUNCTION public._inv_fy(date) SET search_path = public;
ALTER FUNCTION public._inv_mc(date) SET search_path = public;
REVOKE ALL ON FUNCTION public._inv_fy(date), public._inv_mc(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._inv_fy(date), public._inv_mc(date) TO authenticated, service_role;