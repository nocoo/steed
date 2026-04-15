import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DataSourcesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Data Sources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discovered external resources (CLIs, MCP services, platforms)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Data Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Data source list will appear here once data is loaded.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
