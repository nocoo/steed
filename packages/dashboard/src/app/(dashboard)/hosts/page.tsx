import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HostsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Hosts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connected machines running the host service
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Hosts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Host list will appear here once data is loaded.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
