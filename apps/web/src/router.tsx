import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router";
import { Layout } from "./routes/_layout";
import { TopologyPage } from "./routes/topology";

const ConnectPage = lazy(() => import("./routes/connect").then((module) => ({ default: module.ConnectPage })));

function LazyConnectPage() {
  return (
    <Suspense fallback={<div role="status" className="p-6 text-sm text-basalt-muted-foreground">Loading Connect…</div>}>
      <ConnectPage />
    </Suspense>
  );
}

function LegacyTopologyRedirect() {
  return <Navigate to="/topology" replace />;
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/topology" replace /> },
      { path: "topology", element: <TopologyPage /> },
      { path: "topology/:id", element: <LegacyTopologyRedirect /> },
      { path: "diagrams", element: <LegacyTopologyRedirect /> },
      { path: "diagrams/:id", element: <LegacyTopologyRedirect /> },
      { path: "connect", element: <LazyConnectPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

export { routes };
