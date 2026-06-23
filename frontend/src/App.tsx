import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { LoginScreen } from '@/auth/LoginScreen';
import { AppShell } from '@/components/layout/AppShell';

// Route-level code splitting: each page becomes its own chunk loaded on demand,
// so the initial bundle stays small. The Suspense boundary lives in AppShell,
// around the <Outlet/>. Pages use named exports, so map them to default here.
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const InventoryPage = lazy(() =>
  import('@/pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const OrdersListPage = lazy(() =>
  import('@/pages/orders/OrdersListPage').then((m) => ({ default: m.OrdersListPage })),
);
const OrderDetailPage = lazy(() =>
  import('@/pages/orders/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })),
);
const FulfillmentPage = lazy(() =>
  import('@/pages/fulfillment/FulfillmentPage').then((m) => ({ default: m.FulfillmentPage })),
);
const ReturnsPage = lazy(() =>
  import('@/pages/returns/ReturnsPage').then((m) => ({ default: m.ReturnsPage })),
);
const CatalogPage = lazy(() =>
  import('@/pages/catalog/CatalogPage').then((m) => ({ default: m.CatalogPage })),
);
const SourcingRulesPage = lazy(() =>
  import('@/pages/sourcing/SourcingRulesPage').then((m) => ({ default: m.SourcingRulesPage })),
);
const ChannelsPage = lazy(() =>
  import('@/pages/channels/ChannelsPage').then((m) => ({ default: m.ChannelsPage })),
);
const AdminPage = lazy(() =>
  import('@/pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const AssistantPage = lazy(() =>
  import('@/pages/ai/AssistantPage').then((m) => ({ default: m.AssistantPage })),
);

export default function App() {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="orders" element={<OrdersListPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="fulfillment" element={<FulfillmentPage />} />
        <Route path="returns" element={<ReturnsPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="sourcing-rules" element={<SourcingRulesPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
