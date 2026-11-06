import { Navigate } from 'react-router-dom';

/** Выкупы переехали вкладкой в юнит-экономику; старые закладки ведут туда. */
const Buyouts = () => <Navigate to="/crm/analytics/unit-economics?tab=buyouts" replace />;

export default Buyouts;
