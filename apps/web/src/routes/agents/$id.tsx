import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  LayerCard,
  toast,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";
import { LaneChips } from "@/components/ui/lane-chips";
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
    resolver: zodResolver(agentUpdateSchema.transform((v) => v)) as never,
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
      <div className="space-y-8">
        <PageHeader title="Agent" />
        <SkeletonLine className="h-32" />
        <SkeletonLine className="h-64" />
      </div>
    );
  }

  if (error && !agent) {
    return (
      <div className="space-y-8">
        <PageHeader title="Agent" />
        <LayerCard>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-basalt-destructive" />
            <p className="text-sm text-basalt-destructive">{error}</p>
          </div>
        </LayerCard>
      </div>
    );
  }

  if (!agent) return null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={agent.nickname ?? agent.match_key}
        description={agent.match_key}
      />

      <LayerCard>
        <LayerCard.Header>
          <div className="flex w-full items-center justify-between">
            <span>Identity</span>
            <StatusBadge status={agent.status} />
          </div>
        </LayerCard.Header>
        <LayerCard.Body>
          <DescriptionList columns={2}>
            <DescriptionList.Item term="Host">{agent.host_id}</DescriptionList.Item>
            <DescriptionList.Item term="Runtime">
              {agent.runtime_app
                ? `${agent.runtime_app}${agent.runtime_version ? ` v${agent.runtime_version}` : ""}`
                : "Unknown"}
            </DescriptionList.Item>
            <DescriptionList.Item term="Created">
              {new Date(agent.created_at).toLocaleString()}
            </DescriptionList.Item>
            <DescriptionList.Item term="Last seen">
              {agent.last_seen_at
                ? new Date(agent.last_seen_at).toLocaleString()
                : "Never"}
            </DescriptionList.Item>
          </DescriptionList>
        </LayerCard.Body>
      </LayerCard>

      <LayerCard>
        <LayerCard.Header>
          <div>
            <p className="font-semibold text-basalt-foreground">Edit</p>
            <p className="text-sm">Update nickname, role, and lane assignment.</p>
          </div>
        </LayerCard.Header>
        <LayerCard.Body>
          <form onSubmit={onSubmit} className="space-y-6">
            <Field label="Nickname" htmlFor="nickname">
              <Input
                id="nickname"
                placeholder="e.g. Hermes Main"
                {...register("nickname")}
              />
            </Field>
            <Field label="Role" htmlFor="role">
              <InputArea
                id="role"
                rows={3}
                placeholder="What is this agent responsible for?"
                {...register("role")}
              />
            </Field>
            <Field label="Lane">
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
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting || !isDirty}>
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </LayerCard.Body>
      </LayerCard>

      <LayerCard>
        <LayerCard.Header>
          <div className="flex w-full items-center justify-between">
            <div>
              <p className="font-semibold text-basalt-foreground">Data Sources</p>
              <p className="text-sm">Bindings to data sources on this host.</p>
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
        </LayerCard.Header>
        <LayerCard.Body>
          {bindings.loadingBindings ? (
            <SkeletonLine className="h-16" />
          ) : bindings.bindings.length === 0 ? (
            <p className="py-4 text-center text-sm text-basalt-muted-foreground">
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
                    className="flex items-center justify-between rounded-md p-3 text-sm ring-1 ring-basalt-border/40"
                  >
                    <span>
                      <span className="font-medium">
                        {ds?.name ?? b.data_source_id}
                      </span>
                      {ds ? (
                        <span className="ml-2 text-basalt-muted-foreground">
                          ({ds.type})
                        </span>
                      ) : null}
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
        </LayerCard.Body>
      </LayerCard>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add data source</DialogTitle>
            <DialogDescription>
              Pick an unbound data source on this host.
            </DialogDescription>
          </DialogHeader>
          {bindings.loadingCandidates ? (
            <SkeletonLine className="h-24" />
          ) : bindings.candidateDataSources.length === 0 ? (
            <p className="py-4 text-center text-sm text-basalt-muted-foreground">
              No more data sources available.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {bindings.candidateDataSources.map((ds) => (
                <li key={ds.id}>
                  <Button
                    type="button"
                    variant={selectedDsId === ds.id ? "secondary" : "outline"}
                    className="h-auto w-full flex-col items-start py-2"
                    onClick={() => setSelectedDsId(ds.id)}
                  >
                    <p className="font-medium">{ds.name}</p>
                    <p className="text-xs text-basalt-muted-foreground">{ds.type}</p>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
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

function StatusBadge({ status }: { status: AgentStatus }) {
  const variants: Record<AgentStatus, "success" | "secondary" | "warning"> = {
    running: "success",
    stopped: "secondary",
    missing: "warning",
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}
