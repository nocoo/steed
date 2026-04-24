import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router";
import { Layout } from "./routes/_layout";
import { OverviewPage } from "./routes/overview";
import { HostsPage } from "./routes/hosts";
import { AgentsPage } from "./routes/agents/index";
import { AgentDetailPage } from "./routes/agents/$id";
import { DataSourcesPage } from "./routes/data-sources/index";
import { DataSourceDetailPage } from "./routes/data-sources/$id";
import { MapPage } from "./routes/map";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <OverviewPage /> },
      { path: "hosts", element: <HostsPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "agents/:id", element: <AgentDetailPage /> },
      { path: "data-sources", element: <DataSourcesPage /> },
      { path: "data-sources/:id", element: <DataSourceDetailPage /> },
      { path: "map", element: <MapPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

export { routes };
