import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router";
import { Layout } from "./routes/_layout";
import { ConnectPage } from "./routes/connect";
import { TopologyPage } from "./routes/topology";

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
      { path: "connect", element: <ConnectPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

export { routes };
