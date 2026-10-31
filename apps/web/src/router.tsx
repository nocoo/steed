import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router";
import { Layout } from "./routes/_layout";
import { DiagramsPage } from "./routes/diagrams";
import { ConnectPage } from "./routes/connect";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/diagrams" replace /> },
      { path: "diagrams", element: <DiagramsPage /> },
      { path: "diagrams/:id", element: <DiagramsPage /> },
      { path: "connect", element: <ConnectPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

export { routes };
