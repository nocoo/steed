import {
  createBrowserRouter,
  Navigate,
  useParams,
  type RouteObject,
} from "react-router";
import { Layout } from "./routes/_layout";
import { DiagramsPage } from "./routes/diagrams";
import { ConnectPage } from "./routes/connect";

/** Former `/diagrams/:id` links keep working after the Topology rename. */
function LegacyDiagramRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/topology/${encodeURIComponent(id)}` : "/topology"} replace />;
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/topology" replace /> },
      { path: "topology", element: <DiagramsPage /> },
      { path: "topology/:id", element: <DiagramsPage /> },
      { path: "diagrams", element: <LegacyDiagramRedirect /> },
      { path: "diagrams/:id", element: <LegacyDiagramRedirect /> },
      { path: "connect", element: <ConnectPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

export { routes };
