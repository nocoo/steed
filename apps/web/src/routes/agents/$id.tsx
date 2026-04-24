import { useParams } from "react-router";

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Agent Details</h1>
      <p className="text-muted-foreground">Agent {id} details will be here.</p>
    </div>
  );
}
