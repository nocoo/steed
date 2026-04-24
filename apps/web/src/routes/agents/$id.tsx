import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, AlertCircle, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LaneChips } from "@/components/ui/lane-chips";
import { toast } from "@/components/ui/sonner";
import { useAgentDetailViewModel } from "@/viewmodels/use-agent-detail-viewmodel";
import { useAgentBindingsViewModel } from "@/viewmodels/use-agent-bindings-viewmodel";
import { agentUpdateSchema, emptyToNull } from "@/lib/schemas";
import type { LaneId, AgentStatus } from "@steed/shared";

interface FormValues {
  nickname: string;
  role: string;
  lane_id: LaneId | null;
}

export function AgentDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { agent, loading, error, save } = useAgentDetailViewModel(id);
  const bindings = useAgentBindingsViewModel(id, agent?.host_id);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedDsId, setSelectedDsId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    defaultValues: { nickname: "", role: "", lane_id: null },
    resolver: zodResolver(
      agentUpdateSchema.transform((v) => v)
    ) as never,
  });

  useEffect(() => {
    if (agent) {
      reset({
        nickname: agent.nickname ?? "",
        role: agent.role ?? "",
        lane_id: agent.lane_id,
      });
    }
  }, [agent, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const patch = {
      nickname: emptyToNull(values.nickname),
      role: emptyToNull(values.role),
      lane_id: values.lane_id,
    };
    const result = await save(patch);
    if (result.ok) {
      toast.success("Agent saved");
    } else {
      toast.error(result.error ?? "Save failed");
    }
  });

  if (loading && !agent) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !agent) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!agent) return null;

  return (
    <div className="space-y-6">
      <BackLink />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{agent.nickname ?? agent.match_key}</CardTitle>
              <CardDescription>{agent.match_key}</CardDescription>
            </div>
            <StatusBadge status={agent.status} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Host">{agent.host_id}</Field>
          <Field label="Runtime">
            {agent.runtime_app
              ? `${agent.runtime_app}${agent.runtime_version ? ` v${agent.runtime_version}` : ""}`
              : "Unknown"}
          </Field>
          <Field label="Created">
            {new Date(agent.created_at).toLocaleString()}
          </Field>
          <Field label="Last seen">
            {agent.last_seen_at
              ? new Date(agent.last_seen_at).toLocaleString()
              : "Never"}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit</CardTitle>
          <CardDescription>
            Update nickname, role, and lane assignment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                placeholder="e.g. Hermes Main"
                {...register("nickname")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Textarea
                id="role"
                rows={3}
                placeholder="What is this agent responsible for?"
                {...register("role")}
              />
            </div>
            <div className="space-y-2">
              <Label>Lane</Label>
              <Controller
                control={control}
                name="lane_id"
                render={({ field }) => (
                  <LaneChips
                    mode="single"
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isSubmitting}
                  />
                )}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting || !isDirty}>
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Data Sources</CardTitle>
              <CardDescription>
                Bindings to data sources on this host.
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                await bindings.ensureHostDataSources();
                setSelectedDsId(null);
                setAddOpen(true);
              }}
              disabled={bindings.loadingBindings}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bindings.loadingBindings ? (
            <Skeleton className="h-16 w-full" />
          ) : bindings.bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No data sources bound yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {bindings.bindings.map((b) => {
                const ds = bindings.hostDataSources.find(
                  (d) => d.id === b.data_source_id
                );
                return (
                  <li
                    key={b.data_source_id}
                    className="flex items-center justify-between rounded-md border p-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">
                        {ds?.name ?? b.data_source_id}
                      </span>
                      {ds && (
                        <span className="ml-2 text-muted-foreground">
                          ({ds.type})
                        </span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const r = await bindings.removeBinding(b.data_source_id);
                        if (r.ok) toast.success("Binding removed");
                        else toast.error(r.error ?? "Remove failed");
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add data source</DialogTitle>
            <DialogDescription>
              Pick an unbound data source on this host.
            </DialogDescription>
          </DialogHeader>
          {bindings.loadingCandidates ? (
            <Skeleton className="h-24 w-full" />
          ) : bindings.candidateDataSources.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No more data sources available.
            </p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-auto">
              {bindings.candidateDataSources.map((ds) => (
                <li key={ds.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedDsId(ds.id)}
                    className={
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                      (selectedDsId === ds.id
                        ? "border-primary bg-accent"
                        : "border-input hover:bg-accent")
                    }
                  >
                    <p className="font-medium">{ds.name}</p>
                    <p className="text-xs text-muted-foreground">{ds.type}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedDsId}
              onClick={async () => {
                if (!selectedDsId) return;
                const r = await bindings.addBinding(selectedDsId);
                if (r.ok) {
                  toast.success("Binding added");
                  setAddOpen(false);
                } else {
                  toast.error(r.error ?? "Add failed");
                }
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/agents"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to agents
    </Link>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="font-medium">{children}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const variants: Record<AgentStatus, "success" | "secondary" | "warning"> = {
    running: "success",
    stopped: "secondary",
    missing: "warning",
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}
