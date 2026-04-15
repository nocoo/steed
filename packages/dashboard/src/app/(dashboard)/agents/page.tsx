import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Autonomous agent entities across all hosts
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Agent list will appear here once data is loaded.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
