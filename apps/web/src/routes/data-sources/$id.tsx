import { useParams } from "react-router";

export function DataSourceDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Data Source Details</h1>
      <p className="text-muted-foreground">Data source {id} details will be here.</p>
    </div>
  );
}
