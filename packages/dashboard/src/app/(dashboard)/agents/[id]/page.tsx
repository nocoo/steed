"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, AlertCircle } from "lucide-react";
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
import { LaneChips } from "@/components/ui/lane-chips";
import { toast } from "@/components/ui/sonner";
import { useAgentDetailViewModel } from "@/viewmodels/use-agent-detail-viewmodel";
import { agentUpdateSchema, emptyToNull } from "@/lib/schemas";
import type { LaneId, AgentStatus } from "@steed/shared";

interface FormValues {
  nickname: string;
  role: string;
  lane_id: LaneId | null;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AgentDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { agent, loading, error, save } = useAgentDetailViewModel(id);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    defaultValues: { nickname: "", role: "", lane_id: null },
    resolver: zodResolver(
      agentUpdateSchema.transform((v) => v) // schema applies on submitted patch
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
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/agents"
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
