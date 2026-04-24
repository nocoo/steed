import { RouterProvider } from "react-router";
import { router } from "./router";
import { ApiClientProvider } from "./contexts/api-client";

export function App() {
  return (
    <ApiClientProvider>
      <RouterProvider router={router} />
    </ApiClientProvider>
  );
}
